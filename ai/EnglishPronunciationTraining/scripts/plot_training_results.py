"""Render the actual validation learning curve and supported-subset test comparison."""
import csv
import json

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

from project_env import ROOT


def main():
    report = json.loads((ROOT / 'reports/scorer-evaluation.json').read_text(encoding='utf-8'))
    with (ROOT / 'reports/training-history.csv').open(encoding='utf-8') as f:
        history = list(csv.DictReader(f))
    fig, axes = plt.subplots(1, 2, figsize=(11, 4))
    axes[0].plot([int(r['epoch']) for r in history], [float(r['validation_mae']) for r in history], label='MLP validation MAE')
    axes[0].axvline(report['best_mlp_epoch'], linestyle='--', color='#666', label='Best MLP epoch')
    axes[0].set(xlabel='Epoch', ylabel='MAE (score scale 0-2)', title='Validation learning curve')
    axes[0].legend(fontsize=8)
    names = list(report['test']); values = [report['test'][name]['mae'] for name in names]
    colors = ['#1d756c' if name == report['selected_model'] else '#a5b9cd' for name in names]
    axes[1].bar(names, values, color=colors)
    axes[1].set(ylabel='MAE (lower is better)', title='Test: supported phonemes only')
    for i, value in enumerate(values):
        axes[1].text(i, value, f'{value:.3f}', ha='center', va='bottom', fontsize=9)
    axes[1].set_ylim(0, max(values) * 1.25)
    for ax in axes:
        ax.spines[['top', 'right']].set_visible(False)
        ax.grid(axis='y', alpha=.2); ax.set_axisbelow(True)
    coverage = report['coverage']['test']
    fig.suptitle(f"Pronunciation baseline | selected: {report['selected_model']} | test coverage: {coverage['supported_phoneme_percent']}%")
    fig.tight_layout()
    path = ROOT / 'reports/scorer-results.png'; fig.savefig(path, dpi=160); plt.close(fig)
    print(path)


if __name__ == '__main__':
    main()
