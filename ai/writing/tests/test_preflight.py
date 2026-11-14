import sys
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import spacy
from inference import WritingEngine
from fastapi.testclient import TestClient
from serve import create_app


def engine():
    value = WritingEngine.__new__(WritingEngine)
    # A predictable UTF-8 byte tokenizer includes EOS like the real tokenizer.
    def tokenize(text, *, truncation):
        assert truncation is False
        return {"input_ids": list(text.encode("utf-8")) + [1]}
    def must_not_infer(*args):
        raise AssertionError("Preflight must never classify or generate")
    value.cefr = SimpleNamespace(manifest={"max_input_length": 512}, tokenizer=tokenize, classify=must_not_infer)
    value.gec = SimpleNamespace(manifest={"max_input_length": 384}, tokenizer=tokenize, correct=must_not_infer)
    value.nlp = spacy.blank("en")
    value.nlp.add_pipe("sentencizer")
    value.lock = threading.Lock()
    return value


class PreflightTests(unittest.TestCase):
    def test_cefr_whole_input_and_gec_sentence_budgets_are_distinct(self):
        value = engine()
        text = "A " * 220 + "."
        result = value.preflight(text, True)
        self.assertTrue(result["canAnalyze"])
        self.assertEqual(result["cefrTokens"], len(text.encode()) + 1)
        self.assertEqual(result["sentences"][0]["status"], "inputOverBudget")
        over = value.preflight("A " * 300 + ".", True)
        self.assertFalse(over["canAnalyze"])

    def test_same_body_segmentation_cap_and_exact_utf16_spans(self):
        value = engine()
        text = "Dear Alex,\r\n\r\n🙂 I read books.\r\n" + "I read books.\r\n" * 21 + "\r\nBest wishes,\r\nLinh"
        result = value.preflight(text, True)
        self.assertEqual(len(result["sentences"]), 22)
        self.assertEqual([s["status"] for s in result["sentences"]].count("sentenceLimit"), 2)
        encoded = text.encode("utf-16-le")
        extracts = [encoded[s["start"]*2:s["end"]*2].decode("utf-16-le") for s in result["sentences"]]
        self.assertEqual(extracts[0].strip(), "🙂 I read books.")
        self.assertTrue(all(s.strip() == "I read books." for s in extracts[1:]))
        self.assertEqual([s["index"] for s in result["sentences"]], list(range(22)))

    def test_no_model_calls_or_lock_acquisition_even_while_inference_busy(self):
        value = engine()
        value.lock.acquire()
        result = value.preflight("I read books.", False)
        self.assertTrue(result["canAnalyze"])
        self.assertEqual(result["sentences"], [])
        self.assertTrue(value.lock.locked())
        value.lock.release()
        value.gec = None
        result = value.preflight("I read books.", True)
        self.assertFalse(result["correctionsEnabled"])
        self.assertIsNone(result["gecInputLimit"])
        self.assertEqual(result["sentences"], [])

    def test_endpoints_expose_only_capabilities_and_bounded_preflight(self):
        value = engine()
        value.cefr.run_name = "private-directory"
        with TestClient(create_app(lambda: value)) as client:
            capabilities = client.get("/internal/writing/capabilities")
            self.assertEqual(capabilities.status_code, 200)
            self.assertEqual(capabilities.json()["feedbackStatus"], "disabled")
            self.assertNotIn("private-directory", capabilities.text)
            value.lock.acquire()
            self.assertTrue(client.get("/internal/writing/capabilities").json()["busy"])
            value.lock.release()
            response = client.post("/internal/writing/preflight", json={"text": "I read books.", "corrections": True})
            self.assertEqual(response.status_code, 200)
            self.assertNotIn("I read books.", response.text)
            for bad in ({"text": " "}, {"text": "x" * 12001}, {"text": "ok", "run": "elsewhere"}):
                self.assertEqual(client.post("/internal/writing/preflight", json=bad).status_code, 422)

    def test_accepted_suggestion_source_offsets_point_to_exact_repeated_occurrence(self):
        value = engine()
        value.cefr.classify = lambda _: "B1"
        value.gec.correct = lambda s: s.replace("She go", "She goes")
        text = "🙂 I read books.\r\n\r\nShe go home.\r\nShe go home."
        result = value.analyze(text, True)
        self.assertEqual(len(result["errors"]), 2)
        encoded = text.encode("utf-16-le")
        for item in result["errors"]:
            self.assertEqual(encoded[item["sourceStart"]*2:item["sourceEnd"]*2].decode("utf-16-le"), item["original"])
        self.assertNotEqual(result["errors"][0]["sourceStart"], result["errors"][1]["sourceStart"])


if __name__ == "__main__":
    unittest.main()
