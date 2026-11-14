"""Exercise real architecture/PEFT adapters with tiny random configs, no model downloads."""
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from modeling import feedback_tokens, encode_row


class ChatTokenizer:
    def apply_chat_template(self, messages, tokenize=True, add_generation_prompt=False):
        ids = []
        for message in messages:
            ids += [1 if message["role"] == "assistant" else 2]
            ids += [ord(c) for c in message["content"]]
        if add_generation_prompt:
            ids += [1]
        return ids


class SupervisionTests(unittest.TestCase):
    def test_only_the_feedback_completion_has_supervised_labels(self):
        row = dict(prompt="Synthetic topic", text="Original", corrected_text="Corrected", feedback="Explanation")
        item = feedback_tokens(row, ChatTokenizer(), 2048)
        supervised = [label for label in item["labels"] if label != -100]
        self.assertEqual(supervised, [ord(c) for c in "Explanation"])
        self.assertGreater(item["labels"].count(-100), 0)
        self.assertIsNone(feedback_tokens(row, ChatTokenizer(), 10))

    def test_long_essays_and_corrections_are_rejected_instead_of_truncated(self):
        class Tokens:
            def __call__(self, text=None, text_target=None, truncation=False):
                self.assert_no_truncation = truncation is False
                return {"input_ids": list(range(len(text if text is not None else text_target))),
                        "attention_mask": [1] * len(text if text is not None else text_target)}
        tokenizer = Tokens()
        self.assertIsNone(encode_row({"text": "too long", "cefr": "B1"}, "cefr", tokenizer, 3, 20))
        self.assertIsNone(encode_row({"text": "ok", "corrected_text": "too long"}, "gec", tokenizer, 3, 3))
        self.assertTrue(tokenizer.assert_no_truncation)

    @unittest.skipUnless(importlib.util.find_spec("sklearn"), "Requires training metrics dependencies")
    def test_metrics_keep_unsupported_bands_visible_and_do_not_hide_majority_collapse(self):
        import numpy as np
        from modeling import classification_metrics
        logits = np.zeros((4, 6))
        logits[:, 2] = 1
        result = classification_metrics((logits, np.array([1, 1, 2, 3])))
        self.assertEqual(result["accuracy"], 0.25)
        self.assertAlmostEqual(result["macro_f1"], 0.4 / 6)
        self.assertEqual(result["support_A1"], 0)
        self.assertEqual(result["f1_A1"], 0.0)


@unittest.skipUnless(all(importlib.util.find_spec(p) for p in ("torch", "transformers", "peft")),
                     "Install writing training requirements for offline model checks")
class AdapterTests(unittest.TestCase):
    def test_all_three_architectures_backpropagate_and_adapter_roundtrips(self):
        import torch
        from transformers import (DebertaV2Config, DebertaV2ForSequenceClassification,
                                  T5Config, T5ForConditionalGeneration, Qwen2Config, Qwen2ForCausalLM)
        from peft import PeftModel
        from modeling import attach_lora
        torch.set_num_threads(2)
        models = {
            "cefr": lambda: DebertaV2ForSequenceClassification(DebertaV2Config(
                vocab_size=64, hidden_size=24, num_hidden_layers=1, num_attention_heads=4,
                intermediate_size=32, num_labels=6, max_position_embeddings=32)),
            "gec": lambda: T5ForConditionalGeneration(T5Config(
                vocab_size=64, d_model=24, d_ff=32, num_layers=1, num_decoder_layers=1,
                num_heads=4, d_kv=6, decoder_start_token_id=0, pad_token_id=0, eos_token_id=1)),
            "feedback": lambda: Qwen2ForCausalLM(Qwen2Config(
                vocab_size=64, hidden_size=24, intermediate_size=32, num_hidden_layers=1,
                num_attention_heads=4, num_key_value_heads=2, max_position_embeddings=32)),
        }
        for task, factory in models.items():
            with self.subTest(task=task):
                torch.manual_seed(7)
                base = factory()
                initial_state = {k: v.clone() for k, v in base.state_dict().items()}
                model = attach_lora(base, task)
                ids = torch.randint(2, 64, (1, 8))
                labels = torch.tensor([2]) if task == "cefr" else ids.clone()
                model.train()
                loss = model(input_ids=ids, attention_mask=torch.ones_like(ids), labels=labels).loss
                self.assertTrue(torch.isfinite(loss))
                loss.backward()
                grads = [p.grad for n, p in model.named_parameters() if "lora_B" in n]
                self.assertTrue(any(g is not None and g.abs().sum() > 0 for g in grads))
                self.assertTrue(all(p.grad is None for n, p in model.named_parameters()
                                    if not p.requires_grad))
                optimizer = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=1e-3)
                optimizer.step()
                model.eval()
                inputs = dict(input_ids=ids, attention_mask=torch.ones_like(ids))
                if task == "gec":
                    inputs["decoder_input_ids"] = ids
                with torch.no_grad():
                    expected = model(**inputs).logits
                with tempfile.TemporaryDirectory() as directory:
                    model.save_pretrained(directory)
                    reloaded_base = factory()
                    reloaded_base.load_state_dict(initial_state)
                    restored = PeftModel.from_pretrained(reloaded_base, directory).eval()
                    with torch.no_grad():
                        actual = restored(**inputs).logits
                    torch.testing.assert_close(expected, actual)


if __name__ == "__main__":
    unittest.main()
