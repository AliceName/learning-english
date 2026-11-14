import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from gec_loss import edit_weights, weighted_token_loss


class EditLossTests(unittest.TestCase):
    def test_insert_replace_delete_and_unchanged(self):
        for weight in [4, 8]:
            with self.subTest(weight=weight):
                self.assertEqual(edit_weights([5, 6, 1], [5, 7, 1], weight), [1, weight, 1])
                self.assertEqual(edit_weights([5, 1], [5, 7, 1], weight), [1, weight, 1])
                self.assertEqual(edit_weights([5, 7, 1], [5, 1], weight), [1, weight])
                self.assertEqual(edit_weights([5, 6, 7, 1], [5, 7, 1], weight), [1, weight, 1])
                self.assertEqual(edit_weights([5, 1], [5, 1], weight), [1, 1])

    def test_padding_has_no_loss_and_changed_tokens_receive_more_gradient(self):
        import torch
        for weight in [4., 8.]:
            with self.subTest(weight=weight):
                logits = torch.zeros((1, 3, 3), requires_grad=True)
                labels = torch.tensor([[0, 1, -100]])
                weights = torch.tensor([[1.0, weight, 100.0]])
                loss = weighted_token_loss(logits, labels, weights)
                self.assertAlmostEqual(loss.item(), torch.log(torch.tensor(3.)).item(), places=6)
                loss.backward()
                self.assertAlmostEqual(logits.grad[0, 1].abs().sum().item(),
                                       weight * logits.grad[0, 0].abs().sum().item(), places=6)
                self.assertEqual(logits.grad[0, 2].abs().sum().item(), 0)
                self.assertTrue(torch.isfinite(loss).item())
                self.assertTrue(torch.isfinite(logits.grad).all().item())

    def test_current_objective_normalizes_by_weight_sum_of_the_whole_microbatch(self):
        import torch
        import torch.nn.functional as functional
        logits = torch.tensor([[[3., 0., 0.], [0., 2., 0.], [0., 0., 1.]],
                               [[0., 0., 2.], [0., 0., 0.], [0., 0., 0.]]], requires_grad=True)
        labels = torch.tensor([[0, 1, 2], [0, -100, -100]])
        weights = torch.tensor([[1., 4., 1.], [1., 0., 0.]])
        token_losses = functional.cross_entropy(logits.reshape(-1, 3), labels.reshape(-1),
                                               ignore_index=-100, reduction='none').reshape(2, 3)
        expected = (token_losses * weights).sum() / 7
        actual = weighted_token_loss(logits, labels, weights)
        torch.testing.assert_close(actual, expected)
        independent_microbatch_average = (weighted_token_loss(logits[:1], labels[:1], weights[:1]) +
                                         weighted_token_loss(logits[1:], labels[1:], weights[1:])) / 2
        self.assertGreater(abs(actual.item() - independent_microbatch_average.item()), .1)
        actual.backward()
        self.assertTrue(torch.isfinite(logits.grad).all().item())

    def test_add_replace_and_delete_including_eos_have_finite_gradients(self):
        import torch
        for source, target in (([2, 1], [2, 3, 1]), ([2, 3, 1], [2, 4, 1]),
                               ([2, 3, 1], [2, 1])):
            with self.subTest(source=source, target=target):
                logits = torch.zeros((1, len(target) + 1, 5), requires_grad=True)
                labels = torch.tensor([target + [-100]])
                weights = torch.tensor([edit_weights(source, target, 4) + [0.]])
                loss = weighted_token_loss(logits, labels, weights)
                loss.backward()
                self.assertTrue(torch.isfinite(loss).item())
                self.assertTrue(torch.isfinite(logits.grad).all().item())
                self.assertGreater(logits.grad[0, len(target) - 1].abs().sum().item(), 0)
                self.assertEqual(logits.grad[0, -1].abs().sum().item(), 0)


if __name__ == "__main__":
    unittest.main()
