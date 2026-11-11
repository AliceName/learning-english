"""Synthetic examples only; never put licensed corpus sentences in tests."""
import csv
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from data import cefr_band, prepare, remove_cross_split_duplicates, validate_splits, verify_prepared


def archive_fixture(path, misaligned=False, first=False):
    headers = ["public_essay_id", "public_user_id", "public_prompt_id", "text",
               "is_final_version", "humannotator_cefr_level", "split", "is_first_version"]
    rows = [
        ["essay-train", "user-train", "p", "Synthetic learner essay one.", "TRUE", "B1+", "train"],
        ["essay-dev", "user-dev", "p", "Synthetic learner essay two.", "TRUE", "C1", "dev"],
        ["essay-test", "user-test", "p", "Synthetic learner essay three.", "TRUE", "A2+", "test"],
        ["draft", "user-train", "p", "A draft without a human label.", "FALSE", "NA", "train"],
    ]
    rows = [r + ["FALSE"] for r in rows]
    if first:
        for split in ("train", "dev", "test"):
            rows.append([f"first-{split}", f"user-{split}", "p", "Synthetic first draft.", "FALSE", "NA", split, "TRUE"])
    stream = io.StringIO()
    writer = csv.writer(stream, delimiter="\t")
    writer.writerow(headers)
    writer.writerows(rows)
    with ZipFile(path, "w") as archive:
        archive.writestr("whole-corpus/en-writeandimprove2024-corpus.tsv", stream.getvalue())
        for split in ("train", "dev", "test"):
            prefix = "user-prompt-final-versions/en-writeandimprove2024-final-versions-" + split
            archive.writestr(prefix + "-sentences.orig", f"A synthetic {split} sentence .\n")
            archive.writestr(prefix + "-sentences.ids", f"essay-{split}\n")
            if split != "test":
                archive.writestr(prefix + "-sentences.corr", "" if misaligned else f"A corrected {split} sentence .\n")
            if first:
                first_prefix = "user-prompt-first-versions/en-writeandimprove2024-first-versions-" + split
                originals = [f"A new first {split} sentence .", f"A synthetic {split} sentence ."]
                corrections = [f"A corrected first {split} sentence .", f"An alternative {split} correction ."]
                if split == "train":
                    originals.append("A synthetic dev sentence .")  # Cross-split input leakage must be removed.
                    corrections.append("A corrected dev sentence .")
                archive.writestr(first_prefix + "-sentences.orig", "\n".join(originals) + "\n")
                archive.writestr(first_prefix + "-sentences.ids", (f"first-{split}\n") * len(originals))
                if split != "test":
                    archive.writestr(first_prefix + "-sentences.corr", "\n".join(corrections) + "\n")


class DataTests(unittest.TestCase):
    def test_extracted_directory_and_zip_match_and_keep_first_drafts_out_of_cefr(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive_fixture(root / "source.zip", first=True)
            with ZipFile(root / "source.zip") as archive:
                archive.extractall(root / "source")  # Only our synthetic fixture, never a user archive.
            a = prepare(root / "source.zip", root / "zip-output", "first-final")
            b = prepare(root / "source", root / "folder-output", "first-final")
            self.assertEqual(a["source_fingerprint_sha256"], b["source_fingerprint_sha256"])
            self.assertEqual(a["prepared_files_sha256"], b["prepared_files_sha256"])
            self.assertEqual(b["gec"]["train"]["count"], 2)
            self.assertEqual(b["gec_within_split_inputs_removed"]["train"]["conflicting_targets_removed"], 1)
            self.assertEqual(b["gec_cross_split_inputs_removed"]["train"], 1)
            self.assertEqual(b["cefr"]["train"]["count"], 1)
            self.assertNotIn("corrected_text", json.loads((root / "folder-output/gec-test.jsonl").read_text().splitlines()[0]))
            verify_prepared(root / "source", root / "folder-output", "first-final")
            with (root / "folder-output/gec-train.jsonl").open("a") as stream:
                stream.write("\n")
            with self.assertRaisesRegex(ValueError, "JSONL changed"):
                verify_prepared(root / "source", root / "folder-output", "first-final")

    def test_plus_labels_remain_in_the_same_cefr_band(self):
        self.assertEqual(cefr_band("B1+"), "B1")
        self.assertEqual(cefr_band("C2"), "C2")
        with self.assertRaises(ValueError):
            cefr_band("NA")

    def test_archive_keeps_human_final_labels_and_alignment_and_no_fake_test_references(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive_fixture(root / "source.zip")
            report = prepare(root / "source.zip", root / "prepared")
            cefr = [json.loads(s) for s in (root / "prepared/cefr-train.jsonl").read_text().splitlines()]
            self.assertEqual(len(cefr), 1)
            self.assertEqual(cefr[0]["original_cefr"], "B1+")
            self.assertEqual(cefr[0]["cefr"], "B1")
            self.assertNotIn("corrected_text", json.loads((root / "prepared/gec-test.jsonl").read_text()))
            self.assertFalse(report["gec"]["test"]["has_human_corrections"])
            with self.assertRaises(ValueError):
                prepare(root / "source.zip", root / "prepared")

    def test_misaligned_corrections_fail_instead_of_silently_zip_truncating(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive_fixture(root / "source.zip", misaligned=True)
            with self.assertRaisesRegex(ValueError, "Misaligned"):
                prepare(root / "source.zip", root / "prepared")

    def test_exact_duplicates_are_removed_from_training_not_test(self):
        parts = {"train": [{"text": "Same TEXT"}, {"text": "Other"}],
                 "dev": [{"text": "  Same   text "}], "test": [{"text": "same text"}]}
        removed = remove_cross_split_duplicates(parts, "text")
        self.assertEqual(parts["train"], [{"text": "Other"}])
        self.assertEqual(parts["dev"], [])
        self.assertEqual(removed["test"], 0)

    def test_cross_split_users_and_automatic_cefr_labels_are_rejected(self):
        train = dict(id="a", user_id="same", text="Training essay", cefr="B1", label_source="human_final")
        dev = dict(id="b", user_id="same", text="Another essay", cefr="B1", label_source="human_final")
        with self.assertRaisesRegex(ValueError, "leakage"):
            validate_splits({"train": [train], "dev": [dev]}, "cefr")
        train["label_source"] = "automarker"
        with self.assertRaisesRegex(ValueError, "human_final"):
            validate_splits({"train": [train]}, "cefr")

    def test_feedback_requires_reviewed_explanations_not_only_corrected_text(self):
        row = dict(id="a", user_id="u", text="Synthetic input", prompt="A topic",
                   corrected_text="Synthetic correction", feedback="A reviewed explanation", reviewed_by="tutor")
        with self.assertRaisesRegex(ValueError, "reviewed=true"):
            validate_splits({"train": [row]}, "feedback")
        row["reviewed"] = True
        validate_splits({"train": [row]}, "feedback")


if __name__ == "__main__":
    unittest.main()
