"""Conservative, reference-free checks for suggested grammar corrections.

These checks catch observable corruption, not all changes of meaning. Rejected
suggestions must leave the learner's original text available and unchanged.
"""
from __future__ import annotations

from collections import Counter
from difflib import SequenceMatcher
from functools import lru_cache
from importlib import resources
import re

GUARD_VERSION = "gec-safety-v4"


_WORDS = re.compile(r"[^\W_]+(?:['’][^\W_]+)*", re.UNICODE)
_NUMBERS = re.compile(r"(?<!\w)\d+(?:[.,:/-]\d+)*(?:%|\b)")
_GREETING = re.compile(r"(?:dear|hi|hello)\b[^!?\r\n]{0,100}[,:]\s*", re.IGNORECASE)
_CLOSING = re.compile(
    r"(?:yours?(?:\s+(?:sincerely|faithfully|truly))?|sincerely(?:\s+yours)?|"
    r"best(?:\s+(?:wishes|regards))?|kind\s+regards|warm\s+regards|regards|all\s+the\s+best|"
    r"(?:many\s+)?thanks(?:\s+(?:a\s+lot|again|so\s+much))?|thank\s+you|respectfully|"
    r"(?:lots\s+of\s+)?love(?:\s+from)?|see\s+you(?:\s+(?:soon|later|tomorrow|then|there))?|"
    r"take\s+care|bye(?:\s+for\s+now)?|cheers|write\s+(?:back\s+)?soon|talk\s+soon)[,.!]?", re.IGNORECASE)
_SUBJECT_START = re.compile(r"(?:I|we|you|he|she|it|they|this|that|there)\b", re.IGNORECASE)
_MINOR_WORDS = {"a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "at", "for", "with", "by", "from", "as"}
_NEGATIVE = re.compile(r"\b(?:cannot|not|never|no|neither|nor|without|nothing|nobody|nowhere)\b|n['’]t\b", re.IGNORECASE)
_NAME_PARTICLES = {"de", "van", "von", "da", "del", "la", "of"}
_ROLE_WORDS = {
    "student", "teacher", "engineer", "software", "developer", "manager", "director",
    "professor", "lecturer", "coordinator", "assistant", "officer", "senior", "junior",
    "head", "department", "of", "the", "sales", "support", "marketing", "research",
    "team", "university", "college", "school", "dr", "mr", "mrs", "ms", "phd", "msc",
    "bsc", "your",
}
_ROLE_NOUNS = {"student", "teacher", "engineer", "developer", "manager", "director",
               "professor", "lecturer", "coordinator", "assistant", "officer", "head"}


def _words(text: str) -> list[str]:
    return [word.casefold().replace("’", "'") for word in _WORDS.findall(text)]


@lru_cache(maxsize=1)
def _dictionary() -> frozenset[str] | None:
    """ERRANT's bundled British word list (a service dependency); None disables the check."""
    try:
        source = resources.files("errant").joinpath("en/resources/en_GB-large.txt")
        return frozenset(line.strip().casefold() for line in source.read_text(encoding="utf-8").splitlines() if line.strip())
    except (ModuleNotFoundError, FileNotFoundError, OSError):
        return None


def _unknown_word(word: str) -> bool:
    words = _dictionary()
    if words is None or not word.isalpha() or len(word) < 3:
        return False  # Contractions, numbers and very short tokens are not judged.
    # The list is British; accept common American spellings of known words.
    variants = {word, word.replace("or", "our"), word.replace("iz", "is"), word.replace("yz", "ys"),
                re.sub(r"er(s?)$", r"re\1", word), re.sub(r"og$", "ogue", word), re.sub(r"ic(e|es|ed|ing)$", r"is\1", word), re.sub(r"([aeiou])l(ed|ing|er)$", r"\1ll\2", word)}
    return not any(variant in words for variant in variants)


def _signature_line(text: str) -> bool:
    text = text.strip()
    if len(text) > 100 or len(text.split()) > 8 or re.search(r"[!?]", text):
        return False
    if re.match(r"(?:I|we|you|he|she|it|they|this|that|there)\b", text, re.IGNORECASE):
        return False
    # Contact information and names are recognisable without guessing whether a
    # short arbitrary fragment is prose. Unknown tail lines are corrected as body.
    if re.fullmatch(r"(?:(?:e-?mail)\s*:\s*)?[^\s@]+@[^\s@]+\.[^\s@]+", text, re.IGNORECASE):
        return True
    if re.fullmatch(r"(?:https?://|www\.)\S+", text, re.IGNORECASE):
        return True
    if re.fullmatch(r"(?:(?:tel|telephone|phone|mobile)\s*:?\s*)?[+\d][\d\s().-]+", text, re.IGNORECASE):
        return sum(character.isdigit() for character in text) >= 7
    words = _WORDS.findall(text)
    if words and all(character.isalpha() or character in " .'’()-" for character in text):
        if all(word[0].isupper() or word in _NAME_PARTICLES for word in words):
            return True
        lowered = {word.casefold() for word in words}
        if lowered <= _ROLE_WORDS and lowered & _ROLE_NOUNS:
            return True
    return False


def _heading_line(text: str, set_apart: bool) -> bool:
    """A title or section heading on its own line ("What I liked", "My Plans and Goals").

    Only called for lines followed by more text, so an unpunctuated final clause
    is still corrected. Title Case lines count anywhere; other short unpunctuated
    lines count only when set apart by a blank line, so a prose line that merely
    lacks its full stop ("Last year I went to Hue") is still corrected.
    """
    text = text.strip().lstrip("#*").strip().rstrip("*").strip()
    words = _WORDS.findall(text)
    if not words or len(words) > 10 or len(text) > 80 or not text[0].isupper():
        return False
    significant = [word for word in words if word.casefold() not in _MINOR_WORDS]
    if len(words) >= 3 and all(word[0].isupper() for word in significant):
        return not re.search(r"[.;,]", text)  # Title Case, even when it ends with ? or !
    return (set_apart and len(words) <= 6 and not _SUBJECT_START.match(text)
            and not re.search(r"[.!?;,]", text))


def _blank_gap(gap: str) -> bool:
    return len(re.findall(r"\r\n|\r|\n", gap)) >= 2


def body_sentence_spans(text: str, nlp):
    """Yield original body spans without passing layout/signatures to the model.

    A physical line is a formatting boundary. All separators stay in the gaps
    between spans, so CRLF, blank lines and indentation can be copied verbatim.
    """
    lines = [(match.start(), match.group()) for match in re.finditer(r"[^\r\n]+", text)
             if match.group().strip()]
    protected = set()
    for index, (_, line) in enumerate(lines):
        stripped = line.strip()
        if _GREETING.fullmatch(stripped):
            protected.add(index)
        if _CLOSING.fullmatch(stripped):
            protected.add(index)
            tail = lines[index + 1:]
            if len(tail) <= 3 and all(_signature_line(value) for _, value in tail):
                protected.update(range(index + 1, len(lines)))
        if index + 1 < len(lines):
            offset = lines[index][0]
            before = text[lines[index - 1][0] + len(lines[index - 1][1]):offset] if index else None
            after = text[offset + len(line):lines[index + 1][0]]
            # Set apart: a blank line before it; the first line also needs one after it.
            set_apart = (_blank_gap(after) if before is None else _blank_gap(before))
            if _heading_line(stripped, set_apart):
                protected.add(index)
    for index, (offset, line) in enumerate(lines):
        if index not in protected:
            for sentence in nlp(line).sents:
                if sentence.text.strip():
                    yield offset + sentence.start_char, offset + sentence.end_char


def correction_rejection_reason(source: str, proposed: str) -> str | None:
    """Return a stable reason code, using only the input and model output."""
    if source == proposed:
        return None
    original, corrected = _words(source), _words(proposed)
    if not corrected:
        return "empty"
    if re.findall(r"\r\n|\r|\n", source) != re.findall(r"\r\n|\r|\n", proposed):
        return "layout"
    # A grammar suggestion should not invent a long new continuation or remove
    # most of a longer sentence. Small grammatical insertions remain allowed.
    if len(corrected) > max(len(original) + 12, len(original) * 1.75):
        return "expansion"
    if len(original) - len(corrected) >= 5 and len(corrected) < len(original) * 0.6:
        return "deletion"
    for size in range(3, min(8, len(corrected)) + 1):
        old = Counter(tuple(original[index:index + size]) for index in range(len(original) - size + 1))
        new = Counter(tuple(corrected[index:index + size]) for index in range(len(corrected) - size + 1))
        if any(count >= 3 and count > old[gram] for gram, count in new.items()):
            return "repetition"
    for index in range(len(corrected) - 2):
        if corrected[index] == corrected[index + 1] == corrected[index + 2]:
            word = corrected[index]
            old_longest = max((len(match.group().split()) for match in re.finditer(
                rf"\b{re.escape(word)}(?:\s+{re.escape(word)})+\b", " ".join(original))), default=0)
            if old_longest < 3:
                return "repetition"
    if Counter(_NUMBERS.findall(source)) != Counter(_NUMBERS.findall(proposed)):
        return "numbers"
    # A suggestion must not teach a word that does not exist ("trys", "teachs", "cannow").
    if any(_unknown_word(word) for word in set(corrected) - set(original)):
        return "nonword"
    if bool(_NEGATIVE.search(source)) != bool(_NEGATIVE.search(proposed)):
        return "negation"
    # Protect capitalised anchors inside a sentence (names, places, acronyms).
    # The first word is deliberately excluded: e.g. Learning -> To learn can be
    # a valid grammatical repair. This is not a named-entity recognition model.
    anchors = [match.group().casefold() for match in _WORDS.finditer(source)
               if match.start() > 0 and match.group()[0].isupper() and match.group() != "I"]
    if Counter(anchors) - Counter(corrected):
        return "anchors"
    # Catch a deleted segment even when the surviving text is still long.
    segments = [words for part in re.split(r"[,;:!?]|(?<!\d)\.(?!\d)", source)
                if (words := _words(part))]
    if len(segments) > 1 and len(original) - len(corrected) >= 5:
        boundaries = {0}
        for segment in segments:
            boundaries.add(max(boundaries) + len(segment))
        for op, start, end, _, _ in SequenceMatcher(None, original, corrected, autojunk=False).get_opcodes():
            if op == "delete" and end - start >= 5 and start in boundaries and end in boundaries:
                return "segment_deletion"
    return None
