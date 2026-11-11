import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from training_preparation import preparation_provenance
from training_state import file_hash


class PreparationProvenanceTests(unittest.TestCase):
    def test_legacy_policy_does_not_imply_repaired_data(self):
        result = preparation_provenance(None, "gec", Path("unused"), Path("unused"))
        self.assertEqual(result["encoding_policy"], "unchanged-prepared-text-v1")
        self.assertIsNone(result["preparation_report_sha256"])

    def fixture(self, root):
        train, dev, report = [root / n for n in ("train.jsonl", "dev.jsonl", "preparation-report.json")]
        train.write_text("train", encoding="utf-8")
        dev.write_text("dev", encoding="utf-8")
        record = dict(encoding_policy="verified-unicode-train-v1", prepared_files_sha256={
            "gec-train.jsonl": file_hash(train), "gec-dev.jsonl": file_hash(dev)})
        report.write_text(json.dumps(record), encoding="utf-8")
        report.with_suffix(".sha256").write_text(file_hash(report), encoding="ascii")
        return train, dev, report

    def test_hash_binding_and_relocation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            train, dev, report = self.fixture(root)
            result = preparation_provenance(report, "gec", train, dev)
            self.assertEqual(result["preparation_report_sha256"], file_hash(report))
            moved = root / "moved.jsonl"
            moved.write_bytes(train.read_bytes())
            self.assertEqual(result, preparation_provenance(report, "gec", moved, dev))

    def test_reject_changed_data_missing_policy_wrong_task_and_checksum(self):
        for fault in ("data", "policy", "task", "checksum"):
            with self.subTest(fault=fault), tempfile.TemporaryDirectory() as tmp:
                train, dev, report = self.fixture(Path(tmp))
                task = "cefr" if fault == "task" else "gec"
                if fault == "data":
                    train.write_text("changed", encoding="utf-8")
                elif fault == "policy":
                    record = json.loads(report.read_text(encoding="utf-8"))
                    del record["encoding_policy"]
                    report.write_text(json.dumps(record), encoding="utf-8")
                elif fault == "checksum":
                    report.with_suffix(".sha256").write_text("0" * 64, encoding="ascii")
                with self.assertRaises(ValueError):
                    preparation_provenance(report, task, train, dev)


if __name__ == "__main__":
    unittest.main()
