"""Small contract fixture generated in tests; not learner data or a quality set."""
import json
from pathlib import Path


def write_feedback_fixture(path: Path) -> Path:
    rows = []
    for index in range(30):
        verb = "practice" if index < 3 else "practises"
        text = (
            f"Case {index} follows a fictional learner who {verb} English after breakfast at home. "
            "During one session, this learner selects a short article, reads each paragraph, and writes down two unfamiliar expressions. "
            "The learner then checks their meanings, says each phrase aloud, and creates a simple example using familiar vocabulary. "
            "A small notebook keeps track of practice without collecting personal details, grades, or information about any real student. "
            "At the end, the learner reviews the notes and chooses one achievable task for the following day. "
            "These fictional activities describe a routine only; they do not claim that a tutor, score, or model has validated the text."
        )
        errors = ([{"original": "practice", "suggestion": "practises"}] if index < 3 else [])
        rows.append({"id": f"synthetic-feedback-{index:02d}",
                     "topic": None if index < 2 else f"Fictional practice routine {index}",
                     "text": text, "errors": errors})
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")
    return path
