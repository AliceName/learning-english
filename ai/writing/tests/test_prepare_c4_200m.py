import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from data import read_jsonl, validate_splits
from prepare_c4_200m import content_change_reason, edit_profile, parser, prepare
from training_preparation import preparation_provenance
from training_state import check_holdouts

# Fictional sentences written for this test; no corpus content.
GOOD = [(f"She go to school number {i} every morning.", f"She goes to school number {i} every morning.")
        for i in range(30)]
ROWS = GOOD + [
    ("He have a book.", "He have a book."),                                   # identical_pair
    ("only two", "only two words"),                                            # word_count
    ("I buy 3 apples at the market today.", "I bought 4 apples at the market today."),  # guard:numbers
    ("Worthless involved's supporting for the movement today.",
     "Get involved and help the movement now please."),                      # change_ratio / edits
    ("She go to school number 0 every morning.", "She goes to school number 0 every morning."),  # duplicate
    ("The dev sentence are here for testing.", "The dev sentence is here for testing."),  # held-out overlap
    ("x " * 300, "y " * 300),                                                  # too_many_bytes
    ("Why are the required fees so high today?", "Why are the proposed fees so high today?"),  # content_substitution
    ("We�re happy to see you here today.", "We�re happy to see you here now."),      # encoding_damage
]


def write_fixture(root: Path) -> tuple[Path, Path]:
    lines = [f"{a}\t{b}" for a, b in ROWS] + ["malformed line without tab", "a\tb\tc"]
    lines[0] = lines[0].replace("every", "every\0")  # NUL bytes appear in the real shards
    half = len(lines) // 2
    archive = root / "data.zip"
    with ZipFile(archive, "w") as zipped:
        zipped.writestr("data/c4.tsv-00000-of-00002", "\n".join(lines[:half]) + "\n")
        zipped.writestr("data/c4.tsv-00001-of-00002", "\n".join(lines[half:]) + "\n")
    wi = root / "wi"
    wi.mkdir()
    dev = [{"id": "d1", "user_id": "u-dev", "text": "The dev sentence are here for testing.",
            "corrected_text": "The dev sentence is here for testing."}]
    test = [{"id": "t1", "user_id": "u-test", "text": "A held out test sentence goes here."}]
    for name, rows in (("gec-dev.jsonl", dev), ("gec-test.jsonl", test)):
        (wi / name).write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    return archive, wi


class PrepareC4Tests(unittest.TestCase):
    def run_prepare(self, root, *extra):
        archive, wi = write_fixture(root)
        output = root / "out"
        args = parser().parse_args(["--source", str(archive), "--output", str(output), "--wi-dir", str(wi),
                                    "--sample", "20", "--identity-ratio", "0.25", "--preview", "5", *extra])
        return prepare(args), output

    def test_filters_record_every_rejection_reason(self):
        with tempfile.TemporaryDirectory() as tmp:
            report, _ = self.run_prepare(Path(tmp))
        reasons = report["rejections"]
        for reason in ("identical_pair", "word_count", "guard:numbers", "duplicate_input",
                       "wi_heldout_overlap", "too_many_bytes", "malformed", "content_substitution",
                       "encoding_damage"):
            self.assertIn(reason, reasons)
        self.assertTrue(reasons.get("change_ratio") or reasons.get("too_many_edits"))
        self.assertEqual(report["pairs_accepted_before_sampling"], 30)
        self.assertEqual(report["rows_read"], len(ROWS) + 2)

    def test_output_is_valid_for_train_py_and_has_no_leakage(self):
        with tempfile.TemporaryDirectory() as tmp:
            report, output = self.run_prepare(Path(tmp))
            parts = {s: read_jsonl(output / f"gec-{s}.jsonl") for s in ("train", "dev", "test")}
            validate_splits({"train": parts["train"], "dev": parts["dev"]}, "gec")
            check_holdouts(parts)
            provenance = preparation_provenance(output / "preparation-report.json", "gec",
                                                output / "gec-train.jsonl", output / "gec-dev.jsonl")
        self.assertEqual(provenance["encoding_policy"], "c4-200m-filtered-v2")
        self.assertEqual(report["train_rows"], 20)
        self.assertEqual(report["train_pair_kinds"], {"identity": 5, "error": 15})
        identities = [r for r in parts["train"] if r["pair_kind"] == "identity"]
        self.assertTrue(all(r["text"] == r["corrected_text"] for r in identities))
        self.assertTrue(all("\0" not in r["text"] for r in parts["train"]))

    def test_clang8_corpus_labels_provenance(self):
        with tempfile.TemporaryDirectory() as tmp:
            report, output = self.run_prepare(Path(tmp), "--corpus", "clang8", "--min-content-similarity", "0")
            rows = read_jsonl(output / "gec-train.jsonl")
            provenance = preparation_provenance(output / "preparation-report.json", "gec",
                                                output / "gec-train.jsonl", output / "gec-dev.jsonl")
        self.assertEqual(provenance["encoding_policy"], "clang8-filtered-v1")
        self.assertEqual(report["corpus"], "clang8")
        self.assertIn("NAIST", report["license"])
        self.assertTrue(all(r["source"] == "clang8" and r["user_id"] == "clang8-learner"
                            and r["id"].startswith("clang8:") for r in rows))
        self.assertNotIn("content_substitution", report["rejections"])

    def test_same_seed_is_deterministic_and_seed_changes_sample(self):
        digests = []
        for seed in ("7", "7", "8"):
            with tempfile.TemporaryDirectory() as tmp:
                _, output = self.run_prepare(Path(tmp), "--seed", seed)
                digests.append(hashlib.sha256((output / "gec-train.jsonl").read_bytes()).hexdigest())
        self.assertEqual(digests[0], digests[1])
        self.assertNotEqual(digests[0], digests[2])

    def test_per_member_cap_reads_from_every_shard(self):
        with tempfile.TemporaryDirectory() as tmp:
            report, output = self.run_prepare(Path(tmp), "--max-read-per-member", "3")
            lines = {row["source_line"] for row in read_jsonl(output / "gec-train.jsonl")}
        self.assertEqual(report["rows_read"], 6)
        self.assertTrue(any(n <= 3 for n in lines) and any(n > 3 for n in lines))

    def test_refuses_non_empty_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "out").mkdir()
            (root / "out" / "keep.txt").write_text("x", encoding="utf-8")
            with self.assertRaises(ValueError):
                self.run_prepare(root)

    def test_content_change_filter_keeps_grammar_and_spelling_repairs(self):
        for source, target in (
            ("She go to school.", "She goes to school."),
            ("The cats is here.", "The cats are here."),
            ("We arrived at Monday.", "We arrived on Monday."),
            ("I recieve a lot of letters.", "I receive a lot of letters."),
            ("He finished with seven days.", "He finished within seven days."),
            ("I like the picture river.", "I like the picturesque river."),
            ("She is teacher.", "She is a teacher."),
            ("He said that, it was late.", "He said that it was late."),
        ):
            with self.subTest(source=source):
                self.assertIsNone(content_change_reason(source, target, 0.6))

    def test_content_change_filter_blocks_rewrites(self):
        for source, target, reason in (
            ("Why are the required fees high?", "Why are the proposed fees high?", "content_substitution"),
            ("You believe the plan works.", "We believe the plan works.", "content_substitution"),
            ("It is a flight fly here.", "It is a transport aircraft here.", "content_substitution"),
            ("The system confirms the battery.", "The system confirms the battery system.", "content_insertion"),
            ("We saw the old red car.", "We saw the car.", "content_deletion"),
        ):
            with self.subTest(source=source):
                self.assertEqual(content_change_reason(source, target, 0.6), reason)
        self.assertIsNone(content_change_reason("You believe it.", "We believe it.", 0))

    def test_edit_profile(self):
        self.assertEqual(edit_profile("She go home.", "She goes home."), (1, 0.25))
        edits, ratio = edit_profile("Worthless involved's supporting for the movement.",
                                    "Get involved and help the movement!")
        self.assertGreater(ratio, 0.4)


if __name__ == "__main__":
    unittest.main()
