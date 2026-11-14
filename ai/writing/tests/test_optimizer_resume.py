"""Real CPU Trainer resume: interrupted fixed schedule must match uninterrupted training."""
import copy
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class OptimizerResumeTests(unittest.TestCase):
    def test_adapter_optimizer_scheduler_and_rng_resume_same_fixed_horizon(self):
        import torch
        from peft import get_peft_model_state_dict
        from transformers import T5Config, T5ForConditionalGeneration, Seq2SeqTrainingArguments, TrainerCallback
        from gec_loss import edit_trainer_class, edit_weights
        from modeling import attach_lora
        torch.set_num_threads(2)
        torch.manual_seed(42)
        config = T5Config(vocab_size=32, d_model=16, d_ff=24, num_layers=1, num_decoder_layers=1,
                          num_heads=2, d_kv=8, decoder_start_token_id=0, pad_token_id=0, eos_token_id=1)
        initial = copy.deepcopy(T5ForConditionalGeneration(config).state_dict())

        def model():
            torch.manual_seed(42)
            base = T5ForConditionalGeneration(config)
            base.load_state_dict(initial)
            return attach_lora(base, "gec", "qvo")

        data = []
        for index in range(8):
            source = [index + 2, 11, 1]
            target = [index + 2, 12, 1]
            data.append(dict(input_ids=source, attention_mask=[1, 1, 1], labels=target,
                             loss_weights=edit_weights(source, target, 4)))

        def collate(batch):
            return {key: torch.tensor([row[key] for row in batch]) for key in batch[0]}

        class InterruptAtTwo(TrainerCallback):
            def on_step_end(self, args, state, control, **kwargs):
                if state.global_step == 2:
                    control.should_save = True
                    control.should_training_stop = True

        def trainer(folder, callbacks=None):
            args = Seq2SeqTrainingArguments(output_dir=str(folder), max_steps=4,
                per_device_train_batch_size=2, gradient_accumulation_steps=1,
                learning_rate=.0002, lr_scheduler_type="linear", warmup_steps=0,
                optim="adamw_torch", weight_decay=.01, seed=42, data_seed=42,
                use_cpu=True, report_to=[], disable_tqdm=True, remove_unused_columns=False,
                group_by_length=True, save_strategy="steps", save_steps=2, logging_strategy="no")
            return edit_trainer_class()(model=model(), args=args, train_dataset=data,
                                       data_collator=collate, callbacks=callbacks or [])

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            continuous = trainer(root / "continuous")
            continuous.train()
            interrupted = trainer(root / "resumed", [InterruptAtTwo()])
            interrupted.train()
            self.assertEqual(interrupted.state.global_step, 2)
            checkpoint = root / "resumed/checkpoint-2"
            for name in ("adapter_model.safetensors", "optimizer.pt", "scheduler.pt", "rng_state.pth", "trainer_state.json"):
                self.assertTrue((checkpoint / name).is_file(), name)
            resumed = trainer(root / "resumed")
            # A new weights-only branch has no inherited optimizer until resume is requested.
            self.assertIsNone(resumed.optimizer)
            resumed.train(resume_from_checkpoint=str(checkpoint))
            self.assertEqual(resumed.state.global_step, 4)
            self.assertEqual(resumed.lr_scheduler.state_dict(), continuous.lr_scheduler.state_dict())
            left, right = get_peft_model_state_dict(continuous.model), get_peft_model_state_dict(resumed.model)
            self.assertEqual(set(left), set(right))
            for name in left:
                torch.testing.assert_close(left[name], right[name], rtol=0, atol=0)
            expected, actual = continuous.optimizer.state_dict(), resumed.optimizer.state_dict()
            self.assertEqual(expected['param_groups'], actual['param_groups'])
            self.assertEqual(set(expected['state']), set(actual['state']))
            for parameter, state in expected['state'].items():
                for name, value in state.items():
                    if isinstance(value, torch.Tensor):
                        torch.testing.assert_close(value, actual['state'][parameter][name], rtol=0, atol=0)
                    else:
                        self.assertEqual(value, actual['state'][parameter][name])


if __name__ == '__main__':
    unittest.main()
