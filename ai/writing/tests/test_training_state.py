import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from training_state import (check_warm_start, check_resume, file_hash, run_kind,
                            validate_loadable_run, ARTIFACT_FILES, INTEGRITY_VERSION,
                            RESUME_PROVENANCE_FIELDS)


class TrainingStateTests(unittest.TestCase):
    def test_explicit_experiment_never_upgrades_limited_smoke(self):
        self.assertEqual(run_kind(), "training")
        self.assertEqual(run_kind(experiment=True), "experiment")
        for options in (dict(max_steps=3), dict(limit_train=4096), dict(limit_dev=256)):
            self.assertEqual(run_kind(experiment=True, **options), "smoke")

    def test_experiment_offline_opt_in_requires_complete_untampered_artifacts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ARTIFACT_FILES:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"synthetic payload")
            for split in ("train", "dev"):
                (root / (split + ".jsonl")).write_text(split)
            manifest = dict(task="gec", kind="experiment", completed=True, release_eligible=False,
                integrity_version=INTEGRITY_VERSION, initial_adapter_tensor_sha256="a" * 64,
                base_revision="pinned", expected_optimizer_steps=512, global_steps=512,
                model_id="google/byt5-small", gec_lora_profile="qvo",
                data_files={s: str(root / (s + ".jsonl")) for s in ("train", "dev")},
                data_sha256={s: file_hash(root / (s + ".jsonl")) for s in ("train", "dev")},
                artifact_sha256={name: file_hash(root / name) for name in ARTIFACT_FILES})
            def save(**updates):
                (root / "run.json").write_text(json.dumps(dict(manifest, **updates)))
            save()
            with self.assertRaisesRegex(ValueError, "explicit opt-in"):
                validate_loadable_run(root, "gec")
            with patch("lora_expansion.validate_gec_adapter"):
                self.assertEqual(validate_loadable_run(root, "gec", allow_experiment=True)["global_steps"], 512)
                for changes in (dict(completed=False), dict(kind="smoke"), dict(release_eligible=True),
                                dict(global_steps=511), dict(integrity_version=None)):
                    save(**changes)
                    with self.assertRaises(ValueError):
                        validate_loadable_run(root, "gec", allow_experiment=True)
                save()
                (root / ARTIFACT_FILES[0]).write_bytes(b"changed weights")
                with self.assertRaisesRegex(ValueError, "artifact hash"):
                    validate_loadable_run(root, "gec", allow_experiment=True)
                (root / ARTIFACT_FILES[0]).write_bytes(b"synthetic payload")
                (root / "train.jsonl").write_text("changed data")
                with self.assertRaisesRegex(ValueError, "data hash"):
                    validate_loadable_run(root, "gec", allow_experiment=True)

    def test_legacy_training_manifest_still_loadable_without_new_fields(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = dict(task="gec", completed=True, kind="training")
            (root / "run.json").write_text(json.dumps(manifest))
            self.assertEqual(validate_loadable_run(root, "gec"), manifest)

    def test_completed_runs_and_new_schedule_extensions_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            checkpoint = root / "checkpoint-10"
            checkpoint.mkdir()
            manifest = dict(task="gec", kind="experiment", completed=True, epochs=1, max_steps=-1,
                            training_schedule_version="fixed-horizon-v1")
            (root / "run.json").write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, "completed run"):
                check_resume(checkpoint, root, manifest)
            manifest["completed"] = False
            (root / "run.json").write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, "scheduler horizon"):
                check_resume(checkpoint, root, dict(manifest, epochs=2))

    def test_warm_start_checks_historical_training_against_new_holdouts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            train = dict(id="train", user_id="u1", text="Historical training sentence.")
            dev = dict(id="dev", user_id="u2", text="Historical development sentence.")
            paths = {}
            for split, row in (("train", train), ("dev", dev)):
                path = root / f"{split}.jsonl"
                path.write_text(json.dumps(row) + "\n", encoding="utf-8")
                paths[split] = str(path)
            manifest = dict(task="gec", kind="training", completed=True, data_files=paths,
                            data_sha256={s: file_hash(p) for s, p in paths.items()})
            (root / "run.json").write_text(json.dumps(manifest), encoding="utf-8")
            heldout = dict(id="test", user_id="u3", text=train["text"])
            with self.assertRaisesRegex(ValueError, "already seen current test"):
                check_warm_start(root, "gec", {"test": [heldout]})
            heldout["text"] = "An unseen heldout sentence."
            self.assertEqual(check_warm_start(root, "gec", {"test": [heldout]})["task"], "gec")
            Path(paths["train"]).write_text("Changed", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "data changed"):
                check_warm_start(root, "gec", {"test": [heldout]})

    def test_resume_rejects_new_data_and_requires_optimizer_state(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            checkpoint = root / "checkpoint-10"
            checkpoint.mkdir()
            manifest = dict(task="gec", kind="training", data_sha256={"train": "abc"}, epochs=2, max_steps=-1)
            (root / "run.json").write_text(json.dumps(manifest), encoding="utf-8")
            current = dict(manifest, epochs=6)
            for name in ("optimizer.pt", "scheduler.pt", "rng_state.pth"):
                (checkpoint / name).touch()
            (checkpoint / "trainer_state.json").write_text(json.dumps(dict(global_step=10, epoch=2)), encoding="utf-8")
            check_resume(checkpoint, root, current)
            check_resume(checkpoint, root, dict(current, gec_eval_seed=2026))
            check_resume(checkpoint, root, dict(current, gec_lora_profile="qv"))
            with self.assertRaisesRegex(ValueError, "gec_lora_profile"):
                check_resume(checkpoint, root, dict(current, gec_lora_profile="qvo"))
            with self.assertRaisesRegex(ValueError, "gec_eval_seed"):
                check_resume(checkpoint, root, dict(current, gec_eval_seed=2027))
            with self.assertRaisesRegex(ValueError, "data_sha256"):
                check_resume(checkpoint, root, dict(current, data_sha256={"train": "changed"}))
            with self.assertRaisesRegex(ValueError, "gec_scoring_protocol"):
                check_resume(checkpoint, root, dict(current, gec_scoring_protocol="errant-3.0.2-raw-spacy-v2"))
            with self.assertRaisesRegex(ValueError, "cefr_class_weighting"):
                check_resume(checkpoint, root, dict(current, cefr_class_weighting="sqrt-inverse"))
            (checkpoint / "optimizer.pt").unlink()
            with self.assertRaisesRegex(ValueError, "optimizer.pt"):
                check_resume(checkpoint, root, current)

    def test_resume_preserves_every_recorded_objective_and_tokenizer_field(self):
        provenance = dict(loss_version="weighted-v1", loss_source_sha256="a" * 64,
                          tokenizer_sha256="b" * 64, encoding_sources={"encoder.py": "c" * 64},
                          encoding_policy={"long_examples": "skip", "special_tokens": True},
                          preparation_report_sha256="d" * 64)
        self.assertEqual(set(provenance), set(RESUME_PROVENANCE_FIELDS))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            checkpoint = root / "checkpoint-10"
            checkpoint.mkdir()
            manifest = dict(task="gec", kind="experiment", completed=False, epochs=2,
                            max_steps=-1, training_schedule_version="fixed-horizon-v1", **provenance)
            (root / "run.json").write_text(json.dumps(manifest), encoding="utf-8")
            for name in ("optimizer.pt", "scheduler.pt", "rng_state.pth"):
                (checkpoint / name).touch()
            (checkpoint / "trainer_state.json").write_text(json.dumps(dict(global_step=10, epoch=1)), encoding="utf-8")
            self.assertEqual(check_resume(checkpoint, root, dict(manifest)), manifest)
            for key in RESUME_PROVENANCE_FIELDS:
                for change in ("different", "removed", "null"):
                    current = dict(manifest)
                    if change == "removed":
                        current.pop(key)
                    else:
                        current[key] = "changed" if change == "different" else None
                    with self.subTest(key=key, change=change), self.assertRaisesRegex(ValueError, key):
                        check_resume(checkpoint, root, current)

    def test_resume_legacy_unrecorded_fields_remain_compatible_but_null_is_recorded(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            checkpoint = root / "checkpoint-10"
            checkpoint.mkdir()
            manifest = dict(task="gec", kind="training", completed=False, epochs=2, max_steps=-1)
            (root / "run.json").write_text(json.dumps(manifest), encoding="utf-8")
            for name in ("optimizer.pt", "scheduler.pt", "rng_state.pth"):
                (checkpoint / name).touch()
            (checkpoint / "trainer_state.json").write_text(json.dumps(dict(global_step=10, epoch=1)), encoding="utf-8")
            # Do not invent equivalence for fields the older manifest never stored.
            current = dict(manifest, loss_version="weighted-v1", loss_source_sha256="a" * 64,
                           tokenizer_sha256="b" * 64, encoding_sources={"encoder.py": "c" * 64},
                           encoding_policy={"long_examples": "skip"})
            self.assertEqual(check_resume(checkpoint, root, current), manifest)
            recorded = dict(manifest, loss_version=None)
            (root / "run.json").write_text(json.dumps(recorded), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "loss_version"):
                check_resume(checkpoint, root, current)
            current["loss_version"] = None
            self.assertEqual(check_resume(checkpoint, root, current), recorded)


if __name__ == "__main__":
    unittest.main()
