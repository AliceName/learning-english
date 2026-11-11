import contextlib
import io
from pathlib import Path
import random
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from gec_evaluation import sample_dev
from train import main


class TrainingArgumentTests(unittest.TestCase):
    def test_gec_lora_profile_is_rejected_for_other_tasks_before_data_loading(self):
        with patch.object(sys, "argv", ["train.py", "cefr", "--output", "never-created",
                                       "--gec-lora-profile", "qvo"]), contextlib.redirect_stderr(io.StringIO()) as stderr:
            with self.assertRaises(SystemExit) as error:
                main()
            self.assertEqual(error.exception.code, 2)
            self.assertIn("only to gec", stderr.getvalue())

    def test_nonfinite_parameters_are_rejected_before_loading_data_or_model(self):
        for flag in ("--epochs", "--learning-rate", "--cefr-class-weight-cap", "--gec-edit-weight"):
            for value in ("nan", "inf", "-inf"):
                with self.subTest(flag=flag, value=value), patch.object(sys, "argv", [
                    "train.py", "gec", "--output", "never-created", f"{flag}={value}"
                ]), contextlib.redirect_stderr(io.StringIO()) as stderr:
                    with self.assertRaises(SystemExit) as error:
                        main()
                    self.assertEqual(error.exception.code, 2)
                    self.assertNotIn("Missing train/dev", stderr.getvalue())

    def test_selection_seed_is_explicit_and_independent_of_global_training_rng(self):
        class Tokenizer:
            def __call__(self, *args, **kwargs):
                return {"input_ids": [1, 2]}
        rows = [dict(id=f"{edited}-{index}", text=f"Original {index}.",
                     corrected_text=f"Corrected {index}." if edited else f"Original {index}.")
                for edited in (True, False) for index in range(20)]
        first = sample_dev(rows, Tokenizer(), 32, 32, 8, seed=2026)
        random.seed(9876)
        self.assertEqual(first, sample_dev(rows, Tokenizer(), 32, 32, 8))
        self.assertNotEqual(first, sample_dev(rows, Tokenizer(), 32, 32, 8, seed=2027))


if __name__ == "__main__":
    unittest.main()
