import contextlib
import hashlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import audit_gec
import evaluate_gec
from gec_data_paths import verified_data_paths


class DataPathsTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.run = self.root / "run"
        self.run.mkdir()
        self.data = self.root / "local"
        self.data.mkdir()
        self.splits = ("train", "dev")
        self.manifest = dict(completed=True, kind="training", task="gec",
                             data_files={}, data_sha256={})
        for split, name in zip(self.splits, ("fitting.jsonl", "validation.jsonl")):
            recorded = self.root / "historical" / name
            payload = json.dumps({"id": split, "text": "A synthetic fixture."}).encode()
            (self.data / name).write_bytes(payload)
            self.manifest["data_files"][split] = str(recorded)
            self.manifest["data_sha256"][split] = hashlib.sha256(payload).hexdigest()
        (self.run / "run.json").write_text(json.dumps(self.manifest), encoding="utf-8")

    def test_default_uses_recorded_paths(self):
        for filename in self.manifest["data_files"].values():
            path = Path(filename)
            path.parent.mkdir(exist_ok=True)
            path.write_bytes((self.data / path.name).read_bytes())
        self.assertEqual(verified_data_paths(self.manifest, self.splits),
                         {s: Path(p) for s, p in self.manifest["data_files"].items()})

    def test_override_resolves_manifest_names_in_subdirectories(self):
        nested = self.data / "prepared"
        nested.mkdir()
        (self.data / "validation.jsonl").rename(nested / "validation.jsonl")
        self.assertEqual(verified_data_paths(self.manifest, self.splits, self.data),
                         {"train": self.data / "fitting.jsonl", "dev": nested / "validation.jsonl"})

    def test_missing_file(self):
        (self.data / "validation.jsonl").unlink()
        with self.assertRaisesRegex(ValueError, "Missing dev file"):
            verified_data_paths(self.manifest, self.splits, self.data)

    def test_hash_mismatch(self):
        (self.data / "fitting.jsonl").write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "SHA-256 mismatch for train"):
            verified_data_paths(self.manifest, self.splits, self.data)

    def test_duplicate_name_is_ambiguous_even_if_one_hash_matches(self):
        nested = self.data / "other"
        nested.mkdir()
        (nested / "validation.jsonl").write_bytes(b"different")
        with self.assertRaisesRegex(ValueError, "Ambiguous dev file"):
            verified_data_paths(self.manifest, self.splits, self.data)

    def test_sample_file_does_not_bypass_dev_validation(self):
        sample = self.root / "sample.jsonl"
        sample.write_bytes((self.data / "validation.jsonl").read_bytes())
        (self.data / "validation.jsonl").write_bytes(b"changed")
        args = self.cli(audit_gec) + ["--sample-file", str(sample)]
        stderr = io.StringIO()
        with patch.object(sys, "argv", args), patch.object(audit_gec, "choose_sample") as choose:
            with contextlib.redirect_stderr(stderr), self.assertRaises(SystemExit) as error:
                audit_gec.main()
        self.assertEqual(error.exception.code, 2)
        self.assertIn("SHA-256 mismatch for dev", stderr.getvalue())
        choose.assert_not_called()
        self.assertFalse((self.root / "output").exists())

    def cli(self, module):
        return [module.__name__, "--run", str(self.run), "--data-root", str(self.data),
                "--output", str(self.root / "output")]

    def test_both_clis_accept_same_verified_paths_before_evaluation(self):
        class StopBeforeEvaluation(Exception):
            pass

        for module in (evaluate_gec, audit_gec):
            with self.subTest(cli=module.__name__):
                def verify_and_stop(manifest, splits, data_root):
                    self.assertEqual(tuple(splits), self.splits)
                    self.assertEqual(verified_data_paths(manifest, splits, data_root),
                                     {"train": self.data / "fitting.jsonl",
                                      "dev": self.data / "validation.jsonl"})
                    raise StopBeforeEvaluation

                with patch.object(sys, "argv", self.cli(module)), patch.object(
                    module, "verified_data_paths", side_effect=verify_and_stop
                ):
                    with self.assertRaises(StopBeforeEvaluation):
                        module.main()
                self.assertFalse((self.root / "output").exists())
