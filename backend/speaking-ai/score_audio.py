"""Score an independent WAV and supplied reference text, without dataset labels."""
import argparse
import json
import sys
from pathlib import Path

from engine import SpeakingEngine


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser()
    parser.add_argument('--audio', type=Path, required=True)
    parser.add_argument('--text', required=True)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    result = SpeakingEngine().score(args.audio.read_bytes(), args.text)
    rendered = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        args.output.write_text(rendered + '\n', encoding='utf-8')
    print(rendered)
