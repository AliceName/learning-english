from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from cefr_loss import class_weights, weighted_classification_loss


class CefrClassBalancingTests(unittest.TestCase):
    def test_weights_are_bounded_and_normalised_using_train_frequencies(self):
        counts = [2, 20, 100, 50, 10, 3]  # Synthetic counts, independent of the licensed corpus.
        weights = class_weights(counts, cap=5)
        self.assertAlmostEqual(sum(n * w for n, w in zip(counts, weights)) / sum(counts), 1)
        self.assertAlmostEqual(weights[0] / weights[2], 5)
        self.assertGreater(weights[4], weights[2])
        with self.assertRaises(ValueError):
            class_weights([0, 1])

    def test_rare_label_weight_changes_gradient_even_for_single_example_microbatch(self):
        import torch
        weights = torch.tensor([3., 1.])
        norms = []
        for label in [0, 1]:
            logits = torch.zeros((1, 2), requires_grad=True)
            loss = weighted_classification_loss(logits, torch.tensor([label]), weights)
            loss.backward()
            norms.append(logits.grad.abs().sum().item())
        self.assertAlmostEqual(norms[0] / norms[1], 3)


if __name__ == '__main__':
    unittest.main()
