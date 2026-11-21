"""Edit-level clean-up of a GEC suggestion for one sentence.

The model proposes a whole corrected sentence. Some of its edits are harmful for a
learner (an invented word, a deleted "the" that changes meaning, deleted content),
while other edits in the same sentence are useful. This module keeps the useful
edits, drops the risky ones, and adds a few rule-based fixes for errors the model
often misses (over-regularised past tenses, much/less with plural nouns).

Rules are local and auditable; they do not prove a sentence is correct. spaCy is
used only through ERRANT's already-loaded pipeline; without it, rules that need
part-of-speech tags are skipped.
"""
from __future__ import annotations

from difflib import SequenceMatcher
import re

from gec_safety import _unknown_word
from writing_explanations import _errant

_TOKENS = re.compile(r"\w+(?:['’]\w+)*|[^\w\s]", re.UNICODE)
_PRONOUNS = {"it", "them", "him", "her", "this", "that", "these", "those", "us", "me"}
_PREPOSITIONS = {"at", "in", "on", "for", "to", "with", "about", "from", "of", "by", "during", "after", "before"}
_PLURAL_SUBJECTS = {"we", "they", "you", "i", "these", "those", "both", "many", "several"}
_RELATIVE = {"which", "who", "that"}
# "by + means of transport" takes no article.
_TRANSPORT = {"bus", "car", "cable", "train", "plane", "air", "bike", "bicycle", "boat", "ship", "taxi",
              "motorbike", "subway", "metro", "coach", "ferry", "tram", "underground", "sea", "road", "rail"}

# Over-regularised forms learners write -> (past simple, past participle).
_IRREGULAR = {
    "begined": ("began", "begun"), "blowed": ("blew", "blown"), "breaked": ("broke", "broken"),
    "bringed": ("brought", "brought"), "builded": ("built", "built"), "buyed": ("bought", "bought"),
    "catched": ("caught", "caught"), "choosed": ("chose", "chosen"), "comed": ("came", "come"),
    "cutted": ("cut", "cut"), "digged": ("dug", "dug"), "drawed": ("drew", "drawn"),
    "drinked": ("drank", "drunk"), "drived": ("drove", "driven"), "eated": ("ate", "eaten"),
    "falled": ("fell", "fallen"), "feeded": ("fed", "fed"), "feeled": ("felt", "felt"),
    "fighted": ("fought", "fought"), "finded": ("found", "found"), "flyed": ("flew", "flown"),
    "forgeted": ("forgot", "forgotten"), "freezed": ("froze", "frozen"), "getted": ("got", "got"),
    "gived": ("gave", "given"), "goed": ("went", "gone"), "growed": ("grew", "grown"),
    "heared": ("heard", "heard"), "hided": ("hid", "hidden"), "hitted": ("hit", "hit"),
    "holded": ("held", "held"), "hurted": ("hurt", "hurt"), "keeped": ("kept", "kept"),
    "knowed": ("knew", "known"), "leaved": ("left", "left"), "lended": ("lent", "lent"),
    "losed": ("lost", "lost"), "maked": ("made", "made"), "meaned": ("meant", "meant"),
    "meeted": ("met", "met"), "readed": ("read", "read"), "rided": ("rode", "ridden"),
    "runned": ("ran", "run"), "sayed": ("said", "said"), "seed": None, "selled": ("sold", "sold"),
    "sended": ("sent", "sent"), "shaked": ("shook", "shaken"), "shooted": ("shot", "shot"),
    "sitted": ("sat", "sat"), "sleeped": ("slept", "slept"), "speaked": ("spoke", "spoken"),
    "spended": ("spent", "spent"), "standed": ("stood", "stood"), "stealed": ("stole", "stolen"),
    "sticked": ("stuck", "stuck"), "swimmed": ("swam", "swum"), "taked": ("took", "taken"),
    "teached": ("taught", "taught"), "telled": ("told", "told"), "thinked": ("thought", "thought"),
    "throwed": ("threw", "thrown"), "understanded": ("understood", "understood"),
    "weared": ("wore", "worn"), "winned": ("won", "won"), "writed": ("wrote", "written"),
}
_IRREGULAR = {key: value for key, value in _IRREGULAR.items() if value}
_PERFECT = {"have", "has", "had", "having", "'ve", "’ve", "be", "been", "being", "is", "are", "was", "were", "am", "'s", "’s"}


def _third_person(verb: str) -> str:
    if verb.endswith("y") and len(verb) > 1 and verb[-2] not in "aeiou":
        return verb[:-1] + "ies"
    return verb + ("es" if verb.endswith(("s", "x", "z", "ch", "sh", "o")) else "s")


def _segments(text: str, tokens) -> list[str]:
    """Token i's segment runs from the end of token i-1 to the end of token i (leading space included)."""
    ends = [0] + [match.end() for match in tokens]
    return [text[ends[i]:ends[i + 1]] for i in range(len(tokens))]


def _nlp():
    annotator = _errant()
    return getattr(annotator, "nlp", None) if annotator is not None else None


def _plural_subject(doc, char_start: int) -> bool:
    """True when the verb at char_start has a plural subject in the learner's sentence."""
    verb = next((token for token in doc if token.idx == char_start), None)
    if verb is None:
        return False
    head = verb
    while True:
        subjects = [child for child in head.children if child.dep_ in ("nsubj", "nsubjpass")]
        if subjects or head.dep_ != "conj" or head.head is head:
            break
        head = head.head
    for subject in subjects:
        if subject.tag_ in ("NNS", "NNPS") or subject.lower_ in _PLURAL_SUBJECTS:
            return True
        if any(child.dep_ == "conj" for child in subject.children):
            return True  # "My mother and my sister go"
        if subject.lower_ in _RELATIVE and head.dep_ == "relcl" and head.head.tag_ in ("NNS", "NNPS"):
            return True  # "milk flowers, which only bloom"
    return False


def _risk(old: list[str], new: list[str], position: int, doc, char_start: int,
          previous: str = "", following: str = "") -> str | None:
    """Why one change must not be shown, or None when it can stay."""
    old_lower, new_lower = [word.casefold() for word in old], [word.casefold() for word in new]
    old_words = [word for word in old_lower if word[0].isalnum()]
    new_words = [word for word in new_lower if word[0].isalnum()]
    if any(_unknown_word(word) for word in set(new_words) - set(old_words)):
        return "nonword"
    if "the" in old_words and not ({"the", "a", "an", "this", "that", "my", "your", "our", "their", "his", "her", "its"} & set(new_words)):
        return "article_deletion"  # "afraid of the dark" -> "afraid of dark"
    if len(old_words) - len(new_words) >= 2:
        return "content_deletion"  # "create meeting rooms and common area" -> "create a common area"
    if not new_words and len(old_words) == 1 and old_words[0] in _PRONOUNS:
        return "pronoun_deletion"  # "reasons for learning it." -> "reasons for learning."
    if (not old_words and new_words and new_words[0] in ("a", "an", "the") and previous == "by"
            and following in _TRANSPORT):
        return "transport_article"  # "by plane" -> "by a plane"
    if position == 0 and old_words and old_words[0] in _PREPOSITIONS and old_words[0] not in new_words:
        return "leading_preposition"  # "At weddings, music ..." -> "Weddings, music ..."
    if (doc is not None and len(old_words) == len(new_words) == 1 and len(old) == 1
            and new_words[0] == _third_person(old_words[0]) and _plural_subject(doc, char_start)):
        return "plural_subject"  # "flowers, which only bloom" -> "blooms"
    return None


def keep_safe_edits(original: str, proposed: str) -> tuple[str, list[str]]:
    """Apply only the safe changes of `proposed` to `original`; return the text and dropped reasons."""
    source, target = list(_TOKENS.finditer(original)), list(_TOKENS.finditer(proposed))
    if not source or not target:
        return proposed, []
    old_tokens, new_tokens = [m.group() for m in source], [m.group() for m in target]
    old_segments, new_segments = _segments(original, source), _segments(proposed, target)
    opcodes = SequenceMatcher(a=old_tokens, b=new_tokens, autojunk=False).get_opcodes()
    if all(tag == "equal" for tag, *_ in opcodes):
        return proposed, []
    nlp = _nlp()
    doc = nlp(original) if nlp is not None else None
    pieces, dropped = [], []
    for tag, i1, i2, j1, j2 in opcodes:
        if tag == "equal":
            pieces.extend(old_segments[i1:i2])
            continue
        char_start = source[i1].start() if i1 < len(source) else len(original)
        previous = old_tokens[i1 - 1].casefold() if i1 else ""
        following = old_tokens[i2].casefold() if i2 < len(old_tokens) else ""
        reason = _risk(old_tokens[i1:i2], new_tokens[j1:j2], i1, doc, char_start, previous, following)
        if reason:
            dropped.append(reason)
            pieces.extend(old_segments[i1:i2])
        else:
            pieces.extend(new_segments[j1:j2])
    if not dropped:
        return proposed, []
    return "".join(pieces) + original[source[-1].end():], dropped


def add_rule_fixes(text: str) -> str:
    """Fix frequent learner errors the model leaves unchanged. Each rule is narrow on purpose."""
    tokens = list(_TOKENS.finditer(text))
    replacements = []
    lowered = [match.group().casefold() for match in tokens]
    for index, match in enumerate(tokens):
        word = lowered[index]
        if word in _IRREGULAR:
            past, participle = _IRREGULAR[word]
            perfect = any(previous in _PERFECT for previous in lowered[max(0, index - 3):index])
            replacements.append((match, participle if perfect else past))
    nlp = _nlp()
    if nlp is not None and re.search(r"\b(?:much|less)\b", text, re.IGNORECASE):
        doc = nlp(text)
        for token in doc[:-1]:
            following = doc[token.i + 1]
            if following.tag_ != "NNS" or (token.i + 2 < len(doc) and doc[token.i + 2].lower_ == "than"):
                continue
            new = {"much": "many", "less": "fewer"}.get(token.lower_)
            if new:
                match = next((m for m in tokens if m.start() == token.idx), None)
                if match is not None:
                    replacements.append((match, new))
    for match, new in sorted(replacements, key=lambda item: item[0].start(), reverse=True):
        old = match.group()
        new = new.capitalize() if old[0].isupper() else new
        text = text[:match.start()] + new + text[match.end():]
    return text
