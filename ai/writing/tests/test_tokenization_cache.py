import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tokenization_cache import encode_cached, json_hash, tokenizer_fingerprint
from train import encode_split


class Tokenizer:
    padding_side = "right"
    truncation_side = "right"
    special_tokens_map = {"eos_token": "</s>"}
    init_kwargs = {"extra_ids": 0}
    added_tokens_decoder = {}

    def get_vocab(self):
        return {"a": 1, "b": 2, "</s>": 3}

    def __call__(self, text=None, text_target=None, **kwargs):
        tokens = [1] * len((text if text is not None else text_target).split()) + [3]
        return {"input_ids": tokens, "attention_mask": [1] * len(tokens)}


class TokenizationCacheTests(unittest.TestCase):
    def key(self):
        return dict(task="gec", split="train", data_sha256="data-a", model_id="test/model",
                    base_revision="revision-a", tokenizer_sha256=tokenizer_fingerprint(Tokenizer()),
                    transformers_version="test", encoding_sources={"encoder": "source-a"},
                    max_input_length=32, max_target_length=32, limit=None, sampling_seed=42,
                    gec_edit_weight=4.0)

    def builder(self):
        dataset, stats = encode_split([dict(text="She go.", corrected_text="She goes.")],
                                      "gec", Tokenizer(), 32, 32, None, 42, 4.0)
        return dataset.rows, stats

    def test_second_identical_run_reuses_exact_rows_without_tokenizing(self):
        with tempfile.TemporaryDirectory() as directory:
            key = self.key()
            first = encode_cached(directory, key, self.builder)
            with patch.object(Tokenizer, "__call__", side_effect=AssertionError("Retokenized")):
                second = encode_cached(directory, key, self.builder)
            self.assertEqual(first[:2], second[:2])
            self.assertEqual(first[2]["status"], "miss")
            self.assertEqual(second[2]["status"], "hit")
            self.assertEqual(len(list(Path(directory).glob("*.json"))), 1)
            self.assertEqual(list(Path(directory).glob("*.tmp")), [])

    def test_all_encoding_inputs_invalidate_key_including_order_source_seed_and_weight(self):
        changes = dict(data_sha256="reordered-data", tokenizer_sha256="other-tokenizer", base_revision="other-revision",
                       max_input_length=64, max_target_length=64, limit=1, sampling_seed=99,
                       gec_edit_weight=8.0, encoding_sources={"encoder": "changed"}, transformers_version="other")
        with tempfile.TemporaryDirectory() as directory:
            key = self.key()
            encode_cached(directory, key, self.builder)
            for field, value in changes.items():
                with self.subTest(field=field):
                    changed = dict(key, **{field: value})
                    self.assertEqual(encode_cached(directory, changed, self.builder)[2]["status"], "miss")

    def test_corrupt_json_or_wrong_tensor_payload_is_rebuilt_without_private_text_log(self):
        with tempfile.TemporaryDirectory() as directory:
            key = self.key()
            expected = encode_cached(directory, key, self.builder)
            path = Path(directory) / f"{json_hash(key)}.json"
            original = path.read_text(encoding="utf-8")
            for malformed in ("not json", original.replace('"input_ids":[1,1,3]', '"input_ids":[99]')):
                path.write_text(malformed, encoding="utf-8")
                with self.assertLogs("tokenization_cache", level="WARNING") as logs:
                    rebuilt = encode_cached(directory, key, self.builder)
                self.assertEqual(rebuilt[:2], expected[:2])
                self.assertNotIn("She go", "\n".join(logs.output))
            payload = json.loads(original)
            payload["rows"][0]["input_ids"] = ["wrong tensor"]
            payload["content_sha256"] = json_hash({"rows": payload["rows"], "stats": payload["stats"]})
            path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertLogs("tokenization_cache", level="WARNING"):
                rebuilt = encode_cached(directory, key, self.builder)
            self.assertEqual(rebuilt[:2], expected[:2])

    def test_disabling_cache_writes_no_files_and_returns_same_data(self):
        with tempfile.TemporaryDirectory() as directory:
            cached = encode_cached(directory, self.key(), self.builder)
            direct = encode_cached(None, self.key(), self.builder)
            self.assertEqual(direct[:2], cached[:2])
            self.assertEqual(direct[2]["status"], "disabled")

    def test_sentencepiece_and_added_token_options_change_fingerprint(self):
        tokenizer = Tokenizer()
        first = tokenizer_fingerprint(tokenizer)
        tokenizer.init_kwargs = {"extra_ids": 1}
        self.assertNotEqual(first, tokenizer_fingerprint(tokenizer))
        before_sentencepiece = tokenizer_fingerprint(tokenizer)
        class SentencePiece:
            def serialized_model_proto(self):
                return b"different-segmentation-model"
        tokenizer.sp_model = SentencePiece()
        self.assertNotEqual(before_sentencepiece, tokenizer_fingerprint(tokenizer))

    def test_tokenizer_location_metadata_does_not_invalidate_identical_content(self):
        first = Tokenizer()
        first.init_kwargs = dict(extra_ids=0, name_or_path="base/model", _name_or_path="base/model",
                                 cache_dir="cache-a", revision="revision-a", _commit_hash="commit-a")
        second = Tokenizer()
        second.init_kwargs = dict(extra_ids=0, name_or_path="run/checkpoint-2", _name_or_path="run/checkpoint-2",
                                  cache_dir="cache-b", revision="revision-b", _commit_hash="commit-b")
        self.assertEqual(tokenizer_fingerprint(first), tokenizer_fingerprint(second))
        second.init_kwargs["extra_ids"] = 1
        self.assertNotEqual(tokenizer_fingerprint(first), tokenizer_fingerprint(second))

    def test_file_backed_tokenizer_options_compare_contents_not_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            first_file = Path(directory) / "original-merges.txt"
            second_file = Path(directory) / "checkpoint-merges.txt"
            first_file.write_bytes(b"identical tokenizer rules")
            second_file.write_bytes(first_file.read_bytes())
            first, second = Tokenizer(), Tokenizer()
            first.init_kwargs = {"extra_ids": 0, "merges_file": str(first_file)}
            second.init_kwargs = {"extra_ids": 0, "merges_file": str(second_file)}
            self.assertEqual(tokenizer_fingerprint(first), tokenizer_fingerprint(second))
            second_file.write_bytes(b"different rules with the same vocabulary")
            self.assertNotEqual(tokenizer_fingerprint(first), tokenizer_fingerprint(second))

    def test_saved_explicit_defaults_match_original_resolved_runtime_settings(self):
        class ResolvedTokenizer(Tokenizer):
            model_max_length = 10 ** 30
            clean_up_tokenization_spaces = False
            extra_special_tokens = {}
            split_special_tokens = False
            model_input_names = ["input_ids", "attention_mask"]
            chat_template = None
        first, second = ResolvedTokenizer(), ResolvedTokenizer()
        first.init_kwargs = {"extra_ids": 0, "name_or_path": "base/model"}
        second.init_kwargs = dict(extra_ids=0, name_or_path="checkpoint-2",
                                  model_max_length=second.model_max_length,
                                  clean_up_tokenization_spaces=False, extra_special_tokens={})
        self.assertEqual(tokenizer_fingerprint(first), tokenizer_fingerprint(second))
        second.model_max_length = 512
        self.assertNotEqual(tokenizer_fingerprint(first), tokenizer_fingerprint(second))
        second.model_max_length = first.model_max_length
        second.chat_template = "{{ messages }}"
        self.assertNotEqual(tokenizer_fingerprint(first), tokenizer_fingerprint(second))

    def test_cefr_cache_preserves_band_counts_and_skips(self):
        key = dict(self.key(), task="cefr", gec_edit_weight=1.0, max_input_length=3)
        def build():
            dataset, report = encode_split([dict(text="Short.", cefr="B1"),
                                            dict(text="This is a much longer essay.", cefr="B2")],
                                           "cefr", Tokenizer(), 3, 32, None, 42)
            return dataset.rows, report
        with tempfile.TemporaryDirectory() as directory:
            first = encode_cached(directory, key, build)
            second = encode_cached(directory, key, build)
            self.assertEqual(first[:2], second[:2])
            self.assertEqual(first[1], dict(selected=2, encoded=1, over_length_skipped=1, labels={"B1": 1}))


if __name__ == "__main__":
    unittest.main()
