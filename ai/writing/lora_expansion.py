"""Validated GEC LoRA profiles and function-preserving q/v to q/v/o expansion."""
from contextlib import nullcontext
import hashlib
import json
from pathlib import Path
import re


GEC_LORA_PROFILES = {"qv": ("q", "v"), "qvo": ("q", "v", "o")}
_KEY = re.compile(r"^(.*\.(q|v|o))\.lora_([AB])\.weight$")


def gec_profile_modules(profile):
    if profile not in GEC_LORA_PROFILES:
        raise ValueError("Unsupported GEC LoRA profile")
    return list(GEC_LORA_PROFILES[profile])


def _inspect(directory, expected_profile=None, expected_model_id=None):
    import torch
    from safetensors.torch import load_file
    directory = Path(directory)
    config_path, state_path = directory / "adapter_config.json", directory / "adapter_model.safetensors"
    config = json.loads(config_path.read_text(encoding="utf-8"))
    modules = config.get("target_modules")
    if not isinstance(modules, list) or len(modules) != len(set(modules)):
        raise ValueError("GEC adapter target_modules must be a unique module list")
    profiles = [name for name, values in GEC_LORA_PROFILES.items() if set(modules) == set(values)]
    if len(profiles) != 1:
        raise ValueError("GEC adapter modules do not match a supported profile")
    profile = profiles[0]
    if expected_profile is not None and profile != expected_profile:
        raise ValueError("GEC adapter configuration differs from manifest/profile")
    if expected_model_id is not None and config.get("base_model_name_or_path") != expected_model_id:
        raise ValueError("GEC adapter base model differs")
    required = {"peft_type": "LORA", "task_type": "SEQ_2_SEQ_LM", "r": 8,
                "lora_alpha": 16, "lora_dropout": 0.05, "bias": "none"}
    if any(config.get(key) != value for key, value in required.items()):
        raise ValueError("GEC adapter must keep rank8/alpha16/dropout0.05 and LoRA task/bias")
    unsupported = ("use_dora", "use_rslora", "use_qalora", "lora_bias", "fan_in_fan_out",
                   "rank_pattern", "alpha_pattern", "modules_to_save", "layers_to_transform",
                   "layers_pattern", "layer_replication", "target_parameters", "trainable_token_indices",
                   "exclude_modules")
    if any(config.get(key) for key in unsupported) or config.get("init_lora_weights", True) is not True:
        raise ValueError("Unsupported GEC adapter configuration override")
    state = load_file(str(state_path), device="cpu")
    pairs, actual_modules = {}, set()
    for key, tensor in state.items():
        match = _KEY.fullmatch(key)
        if not match or tensor.ndim != 2 or not torch.isfinite(tensor).all().item():
            raise ValueError("Malformed or nonfinite GEC adapter tensor")
        module, suffix, side = match.groups()
        actual_modules.add(suffix)
        pairs.setdefault(module, {})[side] = tensor
    if not pairs or actual_modules != set(modules):
        raise ValueError("Adapter tensors do not cover configured GEC modules")
    if any(set(pair) != {"A", "B"} or pair["A"].shape[0] != 8 or pair["B"].shape[1] != 8
           for pair in pairs.values()):
        raise ValueError("Incomplete or wrong-rank GEC LoRA tensor pair")
    metadata = dict(profile=profile, target_modules=gec_profile_modules(profile),
                    adapter_config_sha256=hashlib.sha256(config_path.read_bytes()).hexdigest(),
                    adapter_sha256=hashlib.sha256(state_path.read_bytes()).hexdigest())
    return config, state, metadata


def validate_gec_adapter(directory, expected_profile=None, expected_model_id=None):
    """Inspect only local adapter config/tensors, before loading a GPU backbone."""
    return _inspect(directory, expected_profile, expected_model_id)[2]


def _tensor_digest(state, names):
    digest = hashlib.sha256()
    for name in sorted(names):
        value = state[name].detach().float().cpu().contiguous()
        digest.update(name.encode())
        digest.update(str(tuple(value.shape)).encode())
        digest.update(value.numpy().tobytes())
    return digest.hexdigest()


def load_gec_adapter(base, adapter_dir, profile, *, allow_expansion=False,
                     expected_model_id=None, initialization_seed=None):
    """Load strict adapter state; new o updates are initially exactly zero.

    This accepts a completed parent/checkpoint only after the caller validates its
    run lineage. It never promotes a smoke run or changes serving validation.
    """
    import torch
    from peft import LoraConfig, get_peft_model, get_peft_model_state_dict, set_peft_model_state_dict
    _, source, metadata = _inspect(adapter_dir, expected_model_id=expected_model_id)
    modules = gec_profile_modules(profile)
    expanded = metadata["profile"] != profile
    if expanded and not (allow_expansion and metadata["profile"] == "qv" and profile == "qvo"):
        raise ValueError("Only explicit warm-start qv to qvo expansion is allowed")
    if expanded and any(parameter.device.type != "cpu" for parameter in base.parameters()):
        raise ValueError("Initialize GEC LoRA expansion on the CPU backbone before device placement")
    config = LoraConfig.from_pretrained(adapter_dir)
    config.target_modules = set(modules)
    config.inference_mode = False
    context = torch.random.fork_rng(devices=[]) if expanded and initialization_seed is not None else nullcontext()
    with context:
        if expanded and initialization_seed is not None:
            torch.default_generator.manual_seed(initialization_seed)
        model = get_peft_model(base, config)
    initial = get_peft_model_state_dict(model)
    expected_source = {k for k in initial if not expanded or _KEY.fullmatch(k).group(2) != "o"}
    if set(source) != expected_source or any(source[k].shape != initial[k].shape for k in source):
        raise ValueError("GEC adapter keys/shapes do not exactly match the backbone")
    outcome = set_peft_model_state_dict(model, source)
    if outcome.unexpected_keys:
        raise ValueError("Unexpected GEC adapter state keys")
    loaded = get_peft_model_state_dict(model)
    if any(not torch.equal(loaded[k].cpu(), source[k]) for k in source):
        raise ValueError("Parent q/v adapter tensors were not preserved exactly")
    added = set(loaded) - set(source)
    if any(_KEY.fullmatch(k).group(2) != "o" for k in added):
        raise ValueError("Expansion added modules other than attention o")
    new_b = [k for k in added if _KEY.fullmatch(k).group(3) == "B"]
    new_a = [k for k in added if _KEY.fullmatch(k).group(3) == "A"]
    if expanded and (not new_a or not new_b or any(torch.count_nonzero(loaded[k]).item() for k in new_b)
                     or any(not torch.count_nonzero(loaded[k]).item() for k in new_a)):
        raise ValueError("New attention o must have nonzero A and exactly zero B")
    trainable = [name for name, parameter in model.named_parameters() if parameter.requires_grad]
    if not trainable or any(".lora_A.default.weight" not in name and ".lora_B.default.weight" not in name for name in trainable):
        raise ValueError("Unexpected trainable parameters outside GEC LoRA")
    result = dict(source_profile=metadata["profile"], profile=profile, expanded=expanded,
                  source_adapter_directory=str(Path(adapter_dir).resolve()),
                  target_modules=modules, preserved_tensors=len(source), added_tensors=len(added),
                  parent_adapter_sha256=metadata["adapter_sha256"],
                  parent_config_sha256=metadata["adapter_config_sha256"],
                  initialization_seed=initialization_seed if expanded else None,
                  new_o_a_sha256=_tensor_digest(loaded, new_a) if expanded else None,
                  new_o_b_zero=bool(expanded))
    return model, result
