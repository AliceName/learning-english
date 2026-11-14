"""Run the reproducible baseline. Extraction resumes matching per-utterance caches."""
import subprocess
import sys

from project_env import ROOT


def main():
    for script in ('prepare_manifests.py', 'extract_gop.py', 'train_scorer.py', 'plot_training_results.py'):
        print('Running ' + script, flush=True)
        subprocess.run([sys.executable, str(ROOT / 'scripts' / script)], cwd=ROOT, check=True)


if __name__ == '__main__':
    main()
