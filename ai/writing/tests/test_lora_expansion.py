"""Real, CPU-only T5 adapter expansion and continuation checks; no downloads."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lora_expansion import load_gec_adapter, validate_gec_adapter
from modeling import attach_lora


class GecLoraExpansionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import torch
        torch.set_num_threads(2)

    def prepare_parent(self, root):
        import torch
        from transformers import T5Config, T5ForConditionalGeneration
        torch.manual_seed(7)
        config = T5Config(vocab_size=48, d_model=24, d_ff=32, num_layers=1,
                          num_decoder_layers=1, num_heads=4, d_kv=6,
                          decoder_start_token_id=0, pad_token_id=0, eos_token_id=1)
        base = T5ForConditionalGeneration(config)
        state = copy.deepcopy(base.state_dict())
        parent = attach_lora(base, "gec")
        ids = torch.tensor([[2, 3, 4, 5, 1], [6, 7, 8, 9, 1]])
        batch = dict(input_ids=ids, attention_mask=torch.ones_like(ids), labels=ids)
        parent.train()
        parent(**batch).loss.backward()
        optimizer = torch.optim.AdamW([p for p in parent.parameters() if p.requires_grad], lr=1e-3)
        optimizer.step()
        parent.eval().save_pretrained(root)

        def factory():
            model = T5ForConditionalGeneration(config)
            model.load_state_dict(state)
            return model

        return parent, factory, batch

    def test_expansion_preserves_parent_logits_and_only_adds_zero_o_updates(self):
        import torch
        from peft import get_peft_model_state_dict
        with tempfile.TemporaryDirectory() as directory:
            parent, factory, batch = self.prepare_parent(directory)
            before = get_peft_model_state_dict(parent)
            expanded, metadata = load_gec_adapter(factory(), directory, "qvo", allow_expansion=True,
                                                   initialization_seed=20261026)
            expanded.eval()
            after = get_peft_model_state_dict(expanded)
            self.assertTrue(metadata["expanded"])
            self.assertEqual(metadata["source_profile"], "qv")
            self.assertEqual(metadata["preserved_tensors"], len(before))
            self.assertGreater(metadata["added_tensors"], 0)
            for key in before:
                self.assertTrue(torch.equal(before[key], after[key]), key)
            new = set(after) - set(before)
            self.assertTrue(all(".o.lora_" in key for key in new))
            self.assertTrue(all(torch.count_nonzero(after[key]) == 0 for key in new if ".lora_B." in key))
            self.assertTrue(all(torch.count_nonzero(after[key]) > 0 for key in new if ".lora_A." in key))
            with torch.no_grad():
                expected, observed = parent(**batch), expanded(**batch)
            torch.testing.assert_close(expected.logits, observed.logits, rtol=0, atol=0)
            torch.testing.assert_close(expected.loss, observed.loss, rtol=0, atol=0)
            # Seeded expansion must not depend on how many random values a caller drew.
            other_base = factory()
            torch.rand(81)
            _, other = load_gec_adapter(other_base, directory, "qvo", allow_expansion=True,
                                        initialization_seed=20261026)
            self.assertEqual(metadata["new_o_a_sha256"], other["new_o_a_sha256"])
            isolated_base = factory()
            rng_before = torch.random.get_rng_state().clone()
            with patch("torch.cuda.manual_seed_all", side_effect=AssertionError("CPU expansion must not reseed CUDA")):
                load_gec_adapter(isolated_base, directory, "qvo", allow_expansion=True,
                                 initialization_seed=20261026)
            self.assertTrue(torch.equal(rng_before, torch.random.get_rng_state()))

    def test_both_existing_and_new_modules_train_and_qvo_save_reload(self):
        import torch
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            _, factory, batch = self.prepare_parent(root / "parent")
            model, _ = load_gec_adapter(factory(), root / "parent", "qvo", allow_expansion=True,
                                        initialization_seed=20261026)
            model.train()
            model(**batch).loss.backward()
            for suffix in ("q", "v", "o"):
                grads = [p.grad for n, p in model.named_parameters() if f".{suffix}.lora_B." in n]
                self.assertTrue(grads and any(g is not None and g.abs().sum() > 0 for g in grads), suffix)
            self.assertTrue(all(p.grad is None for p in model.parameters() if not p.requires_grad))
            self.assertTrue(all(".lora_" in n for n, p in model.named_parameters() if p.requires_grad))
            torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=1e-3).step()
            model.eval().save_pretrained(root / "qvo")
            self.assertEqual(validate_gec_adapter(root / "qvo")["profile"], "qvo")
            loaded, metadata = load_gec_adapter(factory(), root / "qvo", "qvo")
            self.assertFalse(metadata["expanded"])
            with torch.no_grad():
                torch.testing.assert_close(model(**batch).logits, loaded.eval()(**batch).logits, rtol=0, atol=0)

    def test_profile_expansion_requires_explicit_permission_and_cannot_shrink(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            _, factory, _ = self.prepare_parent(root / "parent")
            with self.assertRaisesRegex(ValueError, "explicit"):
                load_gec_adapter(factory(), root / "parent", "qvo")
            expanded, _ = load_gec_adapter(factory(), root / "parent", "qvo", allow_expansion=True)
            expanded.save_pretrained(root / "qvo")
            with self.assertRaisesRegex(ValueError, "explicit"):
                load_gec_adapter(factory(), root / "qvo", "qv", allow_expansion=True)
            with self.assertRaisesRegex(ValueError, "manifest/profile"):
                validate_gec_adapter(root / "parent", "qvo")
            with self.assertRaisesRegex(ValueError, "base model"):
                validate_gec_adapter(root / "parent", expected_model_id="wrong-model")

    def test_rank32_adapter_validates_and_rank_mismatch_is_rejected(self):
        from transformers import T5Config, T5ForConditionalGeneration
        config = T5Config(vocab_size=48, d_model=64, d_ff=32, num_layers=1, num_decoder_layers=1,
                          num_heads=4, d_kv=16, decoder_start_token_id=0, pad_token_id=0, eos_token_id=1)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            model = attach_lora(T5ForConditionalGeneration(config), "gec", "qvo", 32)
            self.assertEqual(model.peft_config["default"].r, 32)
            self.assertEqual(model.peft_config["default"].lora_alpha, 64)
            model.save_pretrained(root)
            self.assertEqual(validate_gec_adapter(root, "qvo", expected_rank=32)["rank"], 32)
            with self.assertRaisesRegex(ValueError, "rank"):
                validate_gec_adapter(root, expected_rank=8)
            config_path = root / "adapter_config.json"
            saved = json.loads(config_path.read_text())
            config_path.write_text(json.dumps(dict(saved, lora_alpha=16)))
            with self.assertRaises(ValueError):
                validate_gec_adapter(root)
        for task, rank in (("gec", 16), ("cefr", 32)):
            with self.assertRaises(ValueError):
                attach_lora(T5ForConditionalGeneration(config), task, "qv", rank)

    def test_malformed_config_or_missing_adapter_state_is_rejected(self):
        import torch
        from safetensors.torch import load_file, save_file
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            _, factory, _ = self.prepare_parent(root)
            config_path = root / "adapter_config.json"
            config = json.loads(config_path.read_text())
            for change in ({"r": 16}, {"target_modules": ["q", "v", "wi"]},
                           {"bias": "all"}, {"use_dora": True}):
                config_path.write_text(json.dumps(dict(config, **change)))
                with self.assertRaises(ValueError):
                    validate_gec_adapter(root)
            config_path.write_text(json.dumps(config))
            path = root / "adapter_model.safetensors"
            original = load_file(str(path))
            missing = dict(original)
            key = next(iter(missing))
            del missing[key]
            save_file(missing, str(path))
            with self.assertRaisesRegex(ValueError, "Incomplete"):
                validate_gec_adapter(root)
            missing_pair = {k: v for k, v in original.items() if k.rsplit(".lora_", 1)[0] != key.rsplit(".lora_", 1)[0]}
            save_file(missing_pair, str(path))
            with self.assertRaisesRegex(ValueError, "keys/shapes"):
                load_gec_adapter(factory(), root, "qv")
            nonfinite = dict(original)
            nonfinite[key] = torch.full_like(nonfinite[key], float("nan"))
            save_file(nonfinite, str(path))
            with self.assertRaisesRegex(ValueError, "nonfinite"):
                validate_gec_adapter(root)


if __name__ == "__main__":
    unittest.main()
