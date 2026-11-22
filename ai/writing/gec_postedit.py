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
# Grammar words: swapping these is a grammar edit (article, preposition, auxiliary...), not a change of content.
_FUNCTION = {
    "a", "an", "the", "this", "that", "these", "those", "some", "any", "no", "every", "each", "all", "both",
    "either", "neither", "another", "other", "such", "what", "which", "who", "whom", "whose", "where", "when",
    "why", "how", "i", "me", "my", "mine", "you", "your", "yours", "he", "him", "his", "she", "her", "hers",
    "it", "its", "we", "us", "our", "ours", "they", "them", "their", "theirs", "myself", "yourself", "himself",
    "herself", "itself", "ourselves", "themselves", "one", "ones", "there", "here", "at", "in", "on", "for",
    "to", "with", "about", "from", "of", "by", "during", "after", "before", "into", "onto", "over", "under",
    "since", "until", "till", "through", "between", "among", "against", "without", "within", "towards",
    "toward", "upon", "around", "across", "behind", "like", "as", "than", "and", "or", "but", "so", "because",
    "although", "though", "if", "unless", "while", "whether", "nor", "yet", "then", "be", "am", "is", "are",
    "was", "were", "been", "being", "have", "has", "had", "having", "do", "does", "did", "done", "doing", "will",
    "would", "shall", "should", "can", "could", "may", "might", "must", "not", "much", "many", "more", "most",
    "less", "least", "few", "fewer", "little", "lot", "lots", "very", "too", "also", "only", "just", "even",
    "still", "already", "ever", "never", "always", "often", "really", "quite", "rather", "enough", "up",
    "down", "out", "off", "away", "back", "again",
}
# Rule fixes switched on in add_rule_fixes; offline ablations may narrow this set.
RULE_FIXES = frozenset({"irregular_past", "much_less"})
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
          previous: str = "", following: str = "", old_lemmas=None, new_lemmas=None) -> str | None:
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
    if (len(new_words) - len(old_words) >= 2
            and sum(word.isalpha() and word not in _FUNCTION and word not in old_words for word in new_words) >= 2):
        return "content_insertion"  # "I sometimes a little bit" -> "I sometimes a little bit scared because ... a little bit"
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
    if _swapped_content(old_words, new_words, old_lemmas, new_lemmas) and _swapped_content(
            new_words, old_words, new_lemmas, old_lemmas):
        return "word_substitution"  # "the main reason" -> "the real reason"
    return None


def _swapped_content(words: list[str], others: list[str], lemmas, other_lemmas) -> bool:
    """True when `words` has a content word with no spelling, inflection or lemma match in `others`."""
    other_lemmas = set(other_lemmas or ())
    for word, lemma in zip(words, lemmas or [None] * len(words)):
        if not word.isalpha() or word in _FUNCTION or word in others or (lemma and lemma in other_lemmas):
            continue
        if not any(SequenceMatcher(a=word, b=other, autojunk=False).ratio() >= 0.6 for other in others):
            return True
    return False


def _lemmas(doc) -> dict:
    """Character offset -> lower-case lemma, for tokens of a parsed sentence."""
    return {token.idx: token.lemma_.casefold() for token in doc} if doc is not None else {}


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
    old_lemma, new_lemma = _lemmas(doc), _lemmas(nlp(proposed) if nlp is not None else None)
    pieces, dropped = [], []
    for tag, i1, i2, j1, j2 in opcodes:
        if tag == "equal":
            pieces.extend(old_segments[i1:i2])
            continue
        char_start = source[i1].start() if i1 < len(source) else len(original)
        previous = old_tokens[i1 - 1].casefold() if i1 else ""
        following = old_tokens[i2].casefold() if i2 < len(old_tokens) else ""
        old_words = [m for m in source[i1:i2] if m.group()[0].isalnum()]
        new_words = [m for m in target[j1:j2] if m.group()[0].isalnum()]
        reason = _risk(old_tokens[i1:i2], new_tokens[j1:j2], i1, doc, char_start, previous, following,
                       [old_lemma.get(m.start()) for m in old_words] if old_lemma else None,
                       [new_lemma.get(m.start()) for m in new_words] if new_lemma else None)
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
        if word in _IRREGULAR and "irregular_past" in RULE_FIXES:
            past, participle = _IRREGULAR[word]
            perfect = any(previous in _PERFECT for previous in lowered[max(0, index - 3):index])
            replacements.append((match, participle if perfect else past))
    nlp = _nlp()
    if nlp is not None and "much_less" in RULE_FIXES and re.search(r"\b(?:much|less)\b", text, re.IGNORECASE):
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
