import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import prepare_verified_corpus as verified


class StrictUnicodeTests(unittest.TestCase):
    def test_decode_only_proven_scalar_representation_once(self):
        self.assertEqual(verified.strict_decode(r"can\u2019t and caf\u00e9"), "can’t and café")
        self.assertEqual(verified.strict_decode("already café ’  x\r\n"), "already café ’  x\r\n")
        self.assertEqual(verified.strict_decode(r"\u005cu2019"), r"\u2019")
        self.assertEqual(verified.strict_decode(r"a\u200bb"), "a\u200bb")

    def test_reject_surrogate_malformed_and_control(self):
        for value in (r"\ud800", r"\udfff", r"\u0001", r"\u000a", r"\u007f", r"\u009f", r"\u123", r"\uXXZZ"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                verified.strict_decode(value)

    def test_markdown_ids_must_be_present_and_unique(self):
        self.assertEqual(verified.markdown_essays("### essay_id = e1\nOne.\n\n### essay_id = e2\nTwo.\n"),
                         {"e1": "One.", "e2": "Two."})
        for value in ("No headers.", "### essay_id = e\nOne.\n### essay_id = e\nTwo.\n"):
            with self.assertRaises(ValueError):
                verified.markdown_essays(value)

    def test_escaped_whitespace_requires_exact_raw_codepoint_and_boundary(self):
        for escaped, raw in ((r"x\u0020y", "xy"), (r"x\u00a0y", "x y"),
                             (r"x\u0020y z", "xy z"),
                             (r"x\u0020\u0020y", "x y"),
                             (r"x\u00a0\u0020y", "x \u00a0y")):
            with self.subTest(escaped=escaped, raw=raw):
                self.assertFalse(verified.escaped_whitespace_matches(escaped, raw))
        for escaped, raw in ((r"x\u0020y", "x y"), (r"x\u00a0y", "x\u00a0y"),
                             (r"x\u00a0\u0020y", "x\u00a0 y"),
                             (r"\u0020xy\u0020", " xy "),
                             ("x  y", "xy")):
            with self.subTest(escaped=escaped, raw=raw):
                self.assertTrue(verified.escaped_whitespace_matches(escaped, raw))


class RepairAndDedupTests(unittest.TestCase):
    def row(self, identifier="essay_a:1", version="final"):
        return dict(id=identifier, essay_id="essay_a", source_version=version, split="train",
                    user_id="u1", prompt_id="p1", text=r"I can\u2019t goes.", corrected_text=r"I can\u2019t go.")

    def test_two_sided_authorization_preserves_ids_layout_and_input(self):
        row = self.row()
        row["text"] += "  \r\n"
        row["corrected_text"] += " \t"
        raw = {row["id"]: copy.deepcopy(row)}
        before = copy.deepcopy(row)
        repaired, changes, unresolved = verified.repair_train([row], raw, {("final", "essay_a"): dict(authorized=True)})
        self.assertEqual(row, before)
        self.assertEqual(repaired[0]["text"], "I can’t goes.  \r\n")
        self.assertEqual(repaired[0]["corrected_text"], "I can’t go. \t")
        self.assertEqual(repaired[0]["id"], row["id"])
        self.assertEqual(changes[0]["fields"], ["text", "corrected_text"])
        self.assertFalse(unresolved)

    def test_unproven_kept_unchanged_and_logged(self):
        row = self.row()
        result, changes, unresolved = verified.repair_train([row], {row["id"]: row},
            {("final", "essay_a"): dict(authorized=False, reason="target_mismatch")})
        self.assertEqual(result, [row])
        self.assertFalse(changes)
        self.assertEqual(unresolved[0]["reason"], "target_mismatch")

    def test_prepared_raw_mismatch_rejected(self):
        row = self.row()
        raw = {row["id"]: dict(row, corrected_text="Unapproved.")}
        with self.assertRaises(ValueError):
            verified.repair_train([row], raw, {})

    def test_final_priority_and_conflicting_target_trace(self):
        final, first = self.row(), self.row("first:essay_a:1", "first")
        first["corrected_text"] = "Another target."
        rows, within, cross, trace = verified.deduplicate_train([first, final], {"dev": [], "test": []})
        self.assertEqual(rows, [final])
        self.assertEqual(within["removed"], 1)
        self.assertEqual(trace[0]["kept_id"], final["id"])
        self.assertTrue(trace[0]["conflicting_target"])

    def test_holdout_source_match_removes_train_without_reference(self):
        row = self.row()
        heldouts = {"dev": [dict(id="dev1", text=row["text"].upper())], "test": []}
        before = copy.deepcopy(heldouts)
        rows, _, cross, trace = verified.deduplicate_train([row], heldouts)
        self.assertFalse(rows)
        self.assertEqual(cross["train"], 1)
        self.assertEqual(heldouts, before)
        self.assertEqual(trace[0]["heldout_matches"], [dict(id="dev1", split="dev")])


class PreparationIntegrationTests(unittest.TestCase):
    def make_fixture(self, directory):
        source, base, output = directory / "source", directory / "base", directory / "verified"
        source.mkdir()
        base.mkdir()
        source_hashes = {}
        rows = []
        for version in ("final", "first"):
            subdir = source / f"user-prompt-{version}-versions"
            subdir.mkdir()
            prefix = f"en-writeandimprove2024-{version}-versions-"
            essay = f"essay_{version}"
            original = r"I can\u2019t goes." if version == "final" else "I can’t goes."
            target = r"I can\u2019t go." if version == "final" else "I can’t go."
            for ext, text in (("orig", original), ("corr", target), ("ids", essay)):
                path = subdir / f"{prefix}train-sentences.{ext}"
                path.write_text(text + "\n", encoding="utf-8")
                source_hashes[path.relative_to(source).as_posix()] = verified.sha(path)
            for part, text in (("orig", "I can’t goes."), ("ref1", "I can’t go.")):
                (subdir / f"{prefix}{part}-train.md").write_text(f"### essay_id = {essay}\n{text}\n", encoding="utf-8")
            rows.append(dict(id=("first:" if version == "first" else "") + essay + ":1", essay_id=essay,
                text=original, corrected_text=target, user_id="train_user", prompt_id="p1", split="train", source_version=version))
        for name in verified.FILES:
            values = rows if name == "gec-train.jsonl" else [dict(id=name, text=name + " input", corrected_text="REFERENCE MUST REMAIN BYTEWISE FROZEN")]
            (base / name).write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in values), encoding="utf-8")
        report = dict(gec_versions=["final", "first"], source_files_sha256=source_hashes,
            prepared_files_sha256={name:verified.sha(base/name) for name in verified.FILES},
            gec={s:dict(count=2 if s == "train" else 1) for s in ("train", "dev", "test")},
            gec_effective_versions={s:{"final":1,"first":1} for s in ("train", "dev", "test")})
        (base / "preparation-report.json").write_text(json.dumps(report), encoding="utf-8")
        return source, base, output

    def test_end_to_end_proven_repair_dedup_holdout_copy_and_reuse(self):
        with tempfile.TemporaryDirectory() as temp:
            source, base, output = self.make_fixture(Path(temp))
            report = verified.prepare(source, base, output)
            self.assertEqual(report["encoding_policy"], "verified-unicode-train-v2")
            self.assertEqual(report["representation_repair"]["changed_rows"], 1)
            self.assertEqual(report["representation_repair"]["authorized_essay_count"], 2)
            self.assertEqual(report["gec"]["train"]["count"], 1)
            for name in verified.FILES:
                if name != "gec-train.jsonl":
                    self.assertEqual((base/name).read_bytes(), (output/name).read_bytes())
            self.assertEqual(verified.reuse(source,base,output), report)
            with self.assertRaises(ValueError):
                verified.prepare(source,base,output)

    def test_target_proof_failure_preserves_escaped_train(self):
        with tempfile.TemporaryDirectory() as temp:
            source, base, output = self.make_fixture(Path(temp))
            md = source / "user-prompt-final-versions/en-writeandimprove2024-final-versions-ref1-train.md"
            md.write_text("### essay_id = essay_final\nOther target.\n",encoding="utf-8")
            report=verified.prepare(source,base,output)
            self.assertEqual(report["representation_repair"]["changed_rows"],0)
            self.assertEqual(report["representation_repair"]["unresolved_rows"],1)
            self.assertEqual(report["gec"]["train"]["count"],2)

    def test_reuse_rejects_output_base_markdown_trace_and_report_drift(self):
        for which in ("output", "base", "markdown", "trace", "report"):
            with self.subTest(which=which), tempfile.TemporaryDirectory() as temp:
                source, base, output=self.make_fixture(Path(temp))
                verified.prepare(source,base,output)
                path = {"output":output/"gec-train.jsonl", "base":base/"gec-train.jsonl",
                        "markdown":source/"user-prompt-final-versions/en-writeandimprove2024-final-versions-orig-train.md",
                        "trace":output/"repair-changes.jsonl", "report":output/"preparation-report.json"}[which]
                path.write_bytes(path.read_bytes()+b" ")
                with self.assertRaises(ValueError):verified.reuse(source,base,output)

    def test_duplicate_markdown_header_rejected_before_output(self):
        with tempfile.TemporaryDirectory() as temp:
            source,base,output=self.make_fixture(Path(temp))
            md=source/"user-prompt-final-versions/en-writeandimprove2024-final-versions-orig-train.md"
            md.write_text(md.read_text(encoding="utf-8")*2,encoding="utf-8")
            with self.assertRaises(ValueError):verified.prepare(source,base,output)
            self.assertFalse(output.exists())

    def test_both_streams_reject_missing_or_different_escaped_whitespace(self):
        for stream in ("orig", "corr"):
            for escaped, markdown, expected in ((r"x\u0020y", "xy", False),
                                                (r"x\u00a0y", "x y", False),
                                                (r"x\u0020y", "x y", True),
                                                (r"x\u00a0y", "x\u00a0y", True)):
                with self.subTest(stream=stream, escaped=escaped, markdown=markdown), tempfile.TemporaryDirectory() as temp:
                    source,base,_=self.make_fixture(Path(temp))
                    prefix=source/"user-prompt-final-versions/en-writeandimprove2024-final-versions-"
                    path=Path(str(prefix)+f"train-sentences.{stream}")
                    path.write_text(escaped+"\n",encoding="utf-8")
                    md=Path(str(prefix)+("orig" if stream=="orig" else "ref1")+"-train.md")
                    md.write_text("### essay_id = essay_final\n"+markdown+"\n",encoding="utf-8")
                    preparation=json.loads((base/"preparation-report.json").read_text())
                    preparation["source_files_sha256"][path.relative_to(source).as_posix()]=verified.sha(path)
                    _,proofs,_=verified.load_train_evidence(source,preparation)
                    proof=proofs[("final","essay_final")]
                    self.assertEqual(proof["authorized"],expected)
                    if not expected:
                        self.assertEqual(proof["reason"],"escaped_whitespace_not_proven_in_markdown")


if __name__ == "__main__":
    unittest.main()
