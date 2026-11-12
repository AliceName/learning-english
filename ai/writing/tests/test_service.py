import sys
import importlib.util
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from inference import InputBudgetError, IncompleteGenerationError, EngineBusyError
SERVICE_AVAILABLE = all(importlib.util.find_spec(p) for p in ("fastapi", "httpx"))
if SERVICE_AVAILABLE:
    from fastapi.testclient import TestClient
    from serve import create_app


@unittest.skipUnless(SERVICE_AVAILABLE, "Install requirements-service.txt for API tests")
class ServiceTests(unittest.TestCase):
    def test_service_default_and_explicit_gec_override(self):
        from serve import ROOT
        baseline = ROOT / "artifacts/gec-expanded-v1"
        for env, expected in (
            ({}, ROOT / "artifacts/gec-viet-full-18ep-bs2-ga8-20261111"),
            ({"WRITING_GEC_RUN": str(baseline)}, baseline),
            ({"WRITING_GEC_RUN": " "}, None),
        ):
            with self.subTest(env=env), patch.dict("os.environ", env, clear=True), \
                    patch("serve.WritingEngine", return_value=SimpleNamespace(gec=None)) as engine:
                with TestClient(create_app()) as client:
                    self.assertEqual(client.get("/health").status_code, 200)
                engine.assert_called_once_with(ROOT / "artifacts/cefr-my-first-run", expected, "auto")

    def test_scoring_contract_does_not_accept_or_silently_ignore_topic(self):
        with TestClient(create_app(lambda: SimpleNamespace(gec=None))) as client:
            response = client.post("/internal/writing/analyze", json={
                "text": "A short essay.", "corrections": False, "topic": "A different topic"})
            self.assertEqual(response.status_code, 422)

    def test_validation_and_real_request_flow_without_loading_weights(self):
        received = []

        def analyze(text, corrections):
            received.append((text, corrections))
            return {"cefr": "B1", "correctedText": None, "errors": [], "warnings": ["Test"]}

        with TestClient(create_app(lambda: SimpleNamespace(gec=None, analyze=analyze))) as client:
            self.assertEqual(client.get("/health").json()["correctionsEnabled"], False)
            for body in ({"text": " "}, {"text": "x" * 12001}, {"text": 1},
                         {"text": "ok", "corrections": "false"}, {"text": "ok", "run": "arbitrary"}):
                self.assertEqual(client.post("/internal/writing/analyze", json=body).status_code, 422)
            result = client.post("/internal/writing/analyze", json={"text": "Synthetic essay", "corrections": True})
            self.assertEqual(result.status_code, 200)
            self.assertEqual(result.json()["cefr"], "B1")
            self.assertEqual(received, [("Synthetic essay", True)])

    def test_budget_busy_and_internal_errors_are_distinguished_without_echoing_text(self):
        for error, status in ((InputBudgetError("Too long"), 422), (EngineBusyError("Busy"), 429),
                              (RuntimeError("private learner text"), 503)):
            def fail(*args):
                raise error
            with TestClient(create_app(lambda: SimpleNamespace(gec=None, analyze=fail))) as client:
                result = client.post("/internal/writing/analyze", json={"text": "Synthetic"})
                self.assertEqual(result.status_code, status)
                self.assertNotIn("private learner text", result.text)


@unittest.skipUnless(importlib.util.find_spec("spacy"), "Requires service dependencies")
class EngineTests(unittest.TestCase):
    def setUp(self):
        # These isolate segmentation/guard/coverage with tiny synthetic strings.
        # Real eligibility and HTTP rejection are tested in test_cefr_input.py.
        from unittest.mock import patch
        policy = patch('inference.assess_input', return_value={
            'status':'eligible','reasons':[],'warnings':[],'policyVersion':'cefr-input-v1'})
        policy.start()
        self.addCleanup(policy.stop)

    def engine(self, correct):
        import spacy
        import threading
        from inference import WritingEngine
        engine = WritingEngine.__new__(WritingEngine)
        seen = []
        def classify(text):
            seen.append(text)
            return "B1"
        engine.cefr = SimpleNamespace(classify=classify)
        engine.gec = SimpleNamespace(correct=correct)
        engine.nlp = spacy.blank("en")
        engine.nlp.add_pipe("sentencizer")
        engine.lock = threading.Lock()
        return engine, seen

    def test_grades_original_and_preserves_paragraph_spacing_when_suggestions_change(self):
        engine, seen = self.engine(lambda text: text.replace("She go", "She goes"))
        original = "She go to school.\n\nI like books."
        result = engine.analyze(original, True)
        self.assertEqual(seen, [original])
        self.assertEqual(result["correctedText"], "She goes to school.\n\nI like books.")
        self.assertEqual(len(result["errors"]), 1)
        self.assertEqual(result["cefr"], "B1")
        self.assertEqual(result["errors"][0]["explanations"][0]["category"], "VERB:SVA")
        self.assertEqual(result["errors"][0]["explanations"][0]["original"], "go")
        self.assertEqual(result["errors"][0]["explanations"][0]["suggestion"], "goes")
        self.assertIn("explanationVersion", result["provenance"])

    def test_provenance_captures_loaded_adapter_identity_without_rescoring(self):
        engine, seen = self.engine(lambda text: text)
        engine.cefr.run_name = "cefr-frozen"
        engine.cefr.adapter_sha256 = "a" * 64
        engine.gec.run_name = "gec-frozen"
        engine.gec.adapter_sha256 = "b" * 64
        result = engine.analyze("I like books.", False)
        self.assertEqual(seen, ["I like books."])
        self.assertEqual(result["errors"], [])
        self.assertEqual(result["provenance"]["cefrRun"], "cefr-frozen")
        self.assertEqual(result["provenance"]["gecAdapterSha256"], "b" * 64)

    def test_overlong_sentence_is_preserved_with_warning_and_lock_is_released(self):
        def fail(text):
            raise InputBudgetError("Too long")
        engine, _ = self.engine(fail)
        result = engine.analyze("Synthetic sentence.", True)
        self.assertEqual(result["correctedText"], "Synthetic sentence.")
        self.assertTrue(any("giữ nguyên" in warning for warning in result["warnings"]))
        self.assertFalse(engine.lock.locked())

    def test_changed_sentence_keeps_its_leading_paragraph_whitespace(self):
        engine, _ = self.engine(lambda text: text.replace("She go", "She goes"))
        original = "I like books.\n\n  She go to school.\n"
        result = engine.analyze(original, True)
        self.assertEqual(result["correctedText"], "I like books.\n\n  She goes to school.\n")
        self.assertEqual(len(result["errors"]), 1)
        explanation = result["errors"][0]["explanations"][0]
        self.assertIn(explanation["original"], result["errors"][0]["original"])
        self.assertIn(explanation["suggestion"], result["errors"][0]["suggestion"])

    def test_negative_contraction_token_spacing_does_not_create_a_false_edit(self):
        for original in ("I don't think this is a good idea.", "I can't swim.", "They won't come."):
            with self.subTest(original=original):
                engine, _ = self.engine(lambda text: text.replace("n't", "n ' t"))
                result = engine.analyze(original, True)
                self.assertEqual(result["correctedText"], original)
                self.assertEqual(result["errors"], [])

    def test_model_receives_raw_sentence_punctuation_and_contractions(self):
        received = []
        def correct(text):
            received.append(text)
            return text
        engine, _ = self.engine(correct)
        original = "I don't swim.\n\n  She goes to school.\n"
        result = engine.analyze(original, True)
        self.assertEqual(received, ["I don't swim.", "She goes to school."])
        self.assertEqual(result["correctedText"], original)
        self.assertEqual(result["errors"], [])

    def test_busy_engine_does_not_start_a_second_inference(self):
        engine, seen = self.engine(lambda text: text)
        engine.lock.acquire()
        with self.assertRaises(EngineBusyError):
            engine.analyze("Synthetic.", False)
        self.assertEqual(seen, [])

    def test_sentence_limit_keeps_the_rest_of_the_essay_and_warns(self):
        calls = []
        def correct(text):
            calls.append(text)
            return text
        engine, _ = self.engine(correct)
        original = "One sentence. " * 23
        result = engine.analyze(original, True)
        self.assertEqual(len(calls), 20)
        self.assertEqual(result["correctedText"], original)
        self.assertTrue(any("20 câu" in warning for warning in result["warnings"]))

    def test_coverage_partitions_every_body_sentence_without_calling_model_after_limit(self):
        calls = []
        def correct(text):
            calls.append(text)
            if text == "She go home.":
                return "She goes home."
            if text == "I bought 12 books.":
                return "I bought 13 books."
            if text == "This sentence is over budget.":
                raise InputBudgetError("Too long")
            if text == "This sentence is unfinished.":
                raise IncompleteGenerationError("No EOS")
            if text == "This result is empty.":
                return " "
            return text
        engine, seen = self.engine(correct)
        body = "She go home. I bought 12 books. This sentence is over budget. " \
               "This sentence is unfinished. This result is empty. " + "They read books. " * 17
        original = "Dear Alex,\r\n\r\n" + body + "\r\n\r\nBest wishes,\r\nLinh Nguyễn"
        result = engine.analyze(original, True)
        self.assertEqual(seen, [original])
        self.assertEqual(len(calls), 20)
        self.assertEqual(result["gecCoverage"], {"totalBodySentences": 22, "changed": 1,
            "unchanged": 15, "rejected": 1, "inputOverBudget": 1, "incomplete": 2, "sentenceLimit": 2})
        self.assertEqual(len(result["errors"]), 1)
        self.assertEqual(result["errors"][0]["suggestion"], "She goes home.")
        self.assertEqual(result["correctedText"], original.replace("She go home.", "She goes home.", 1))
        self.assertEqual(result["provenance"]["guardVersion"], "gec-safety-v2")

    def test_coverage_for_twenty_twenty_one_and_twenty_two_repeated_sentences(self):
        for count in (20, 21, 22):
            with self.subTest(count=count):
                calls = []
                engine, _ = self.engine(lambda text: calls.append(text) or text)
                result = engine.analyze("A repeated sentence. " * count, True)
                self.assertEqual(len(calls), 20)
                coverage = result["gecCoverage"]
                self.assertEqual(coverage["totalBodySentences"], count)
                self.assertEqual(coverage["unchanged"], 20)
                self.assertEqual(coverage["sentenceLimit"], count - 20)
                self.assertEqual(sum(value for key, value in coverage.items() if key != "totalBodySentences"), count)

    def test_coverage_is_null_when_corrections_not_requested_or_gec_unavailable(self):
        engine, _ = self.engine(lambda text: self.fail("GEC must not be called"))
        self.assertIsNone(engine.analyze("I like books.", False)["gecCoverage"])
        engine.gec = None
        result = engine.analyze("I like books.", True)
        self.assertIsNone(result["gecCoverage"])
        self.assertIsNone(result["provenance"]["guardVersion"])

    def test_input_budget_and_incomplete_generation_have_distinct_adapter_errors(self):
        import torch
        from inference import Adapter
        adapter = Adapter.__new__(Adapter)
        adapter.device = "cpu"
        adapter.dtype = torch.float32
        adapter.manifest = {"max_target_length": 384}
        adapter.inputs = lambda text: {}
        adapter.tokenizer = SimpleNamespace(eos_token_id=1, decode=lambda ids, **kwargs: "I like books.")
        adapter.model = SimpleNamespace(generate=lambda **kwargs: torch.tensor([[0, 3, 4]]))
        with self.assertRaises(IncompleteGenerationError):
            adapter.correct("I likes books.")
        adapter.model.generate = lambda **kwargs: torch.tensor([[0, 3, 1]])
        self.assertEqual(adapter.correct("I likes books."), "I like books.")

    def test_letter_greeting_signature_and_crlf_are_never_sent_to_model(self):
        received = []
        def correct(text):
            received.append(text)
            return text.replace("I likes", "I like")
        engine, _ = self.engine(correct)
        original = "Dear Sir/Madam,\r\n\r\n  I likes books.\r\n\r\nYour faithfully,\r\n\r\nCatherine"
        result = engine.analyze(original, True)
        self.assertEqual(received, ["I likes books."])
        self.assertEqual(result["correctedText"], original.replace("I likes", "I like"))
        self.assertEqual(len(result["errors"]), 1)

    def test_letter_layout_without_blank_lines_is_preserved(self):
        engine, _ = self.engine(lambda text: text.replace("She go", "She goes"))
        original = "Dear Alex,\nShe go to school.\nBest wishes,\nLinh Nguyen"
        result = engine.analyze(original, True)
        self.assertEqual(result["correctedText"], original.replace("She go", "She goes"))

    def test_unsafe_suggestion_is_not_listed_as_an_accepted_change(self):
        engine, _ = self.engine(lambda text: "I request a new room because " * 4)
        original = "I request a new room because my room is noisy."
        result = engine.analyze(original, True)
        self.assertEqual(result["correctedText"], original)
        self.assertEqual(result["errors"], [])
        self.assertTrue(any("bị chặn" in warning for warning in result["warnings"]))

    def test_bad_sentence_falls_back_but_valid_correction_in_same_essay_is_kept(self):
        def correct(text):
            return "I bought 13 books." if "12 books" in text else text.replace("She go", "She goes")
        engine, _ = self.engine(correct)
        original = "I bought 12 books.\n\nShe go to school."
        result = engine.analyze(original, True)
        self.assertEqual(result["correctedText"], "I bought 12 books.\n\nShe goes to school.")
        self.assertEqual(len(result["errors"]), 1)

    def test_dropped_segment_does_not_emit_a_suggestion(self):
        engine, _ = self.engine(lambda text: "We tested it yesterday, and we filed a report.")
        source = "We tested it yesterday, the battery lost half its charge, and we filed a report."
        result = engine.analyze(source, True)
        self.assertEqual(result["correctedText"], source)
        self.assertEqual(result["errors"], [])
        self.assertEqual(result["gecCoverage"]["rejected"], 1)

    def test_new_model_line_breaks_are_blocked_instead_of_changing_layout(self):
        engine, _ = self.engine(lambda text: "I like\nbooks.")
        result = engine.analyze("I likes books.", True)
        self.assertEqual(result["correctedText"], "I likes books.")
        self.assertEqual(result["errors"], [])

    def test_twenty_sentence_budget_excludes_protected_letter_lines(self):
        received = []
        def correct(text):
            received.append(text)
            return text
        engine, _ = self.engine(correct)
        original = "Dear Alex,\n\n" + "One sentence. " * 20 + "\n\nBest wishes,\nLinh"
        result = engine.analyze(original, True)
        self.assertEqual(len(received), 20)
        self.assertEqual(result["correctedText"], original)
        self.assertFalse(any("20 câu" in warning for warning in result["warnings"]))

    def test_prose_after_thanks_is_not_mistaken_for_a_signature(self):
        for ending in (".", ""):
            with self.subTest(ending=ending):
                received = []
                def correct(text):
                    received.append(text)
                    return text.replace("I likes", "I like")
                engine, _ = self.engine(correct)
                result = engine.analyze("Thanks.\nI likes reading books" + ending, True)
                self.assertEqual(received, ["I likes reading books" + ending])
                self.assertEqual(result["correctedText"], "Thanks.\nI like reading books" + ending)

    def test_unpunctuated_short_clauses_after_closing_are_not_signature_names(self):
        for body in ("I likes books", "She go home", "books is interesting"):
            with self.subTest(body=body):
                received = []
                def correct(text):
                    received.append(text)
                    return text.replace("likes", "like").replace("She go", "She goes").replace("books is", "books are")
                engine, _ = self.engine(correct)
                result = engine.analyze("Thanks.\n" + body, True)
                self.assertEqual(received, [body])
                self.assertEqual(len(result["errors"]), 1)

    def test_name_role_and_contact_signature_tail_is_protected(self):
        for tail in ("Catherine", "Linh Nguyen\nsoftware developer\nEmail: linh@example.com",
                     "Dr. Linh Nguyen\nPhone: +84 912 345 678\nhttps://example.com"):
            with self.subTest(tail=tail):
                received = []
                def correct(text):
                    received.append(text)
                    return text.replace("I likes", "I like")
                engine, _ = self.engine(correct)
                original = "Dear Alex,\nI likes books.\nBest wishes,\n" + tail
                result = engine.analyze(original, True)
                self.assertEqual(received, ["I likes books."])
                self.assertEqual(result["correctedText"], original.replace("I likes", "I like"))


if __name__ == "__main__":
    unittest.main()
