"""Conservative Vietnamese descriptions of accepted edits, not correctness proofs.

No corpus, external service, statistical tagger or generated supervision is used.
Fragments are sliced from the original strings, so CRLF and repeated words are
never interpreted as whitespace-normalised M2 offsets.
"""
from __future__ import annotations

from difflib import SequenceMatcher
import re
import threading

TEMPLATE_VERSION = "vi-edit-templates-v1"
# v2: changes the v1 whitelist cannot explain are typed with ERRANT (spaCy, local) and
# described by kind of change only. Like v1, this does not say the suggestion is correct.
TEMPLATE_VERSION_V2 = "vi-edit-templates-v2"
_ERRANT_LOCK = threading.Lock()
_ERRANT_STATE: dict = {}
_WORD_CHOICE = frozenset({"VERB", "NOUN", "ADJ", "ADV"})
_OPS = {"M": "Có thể thiếu", "U": "Có thể thừa", "R": "Có thể cần đổi"}
_KINDS = {
    "VERB:SVA": ("dạng động từ theo chủ ngữ", "Chủ ngữ số ít (he, she, it, my mother…) và số nhiều chia động từ khác nhau."),
    "VERB:TENSE": ("thì của động từ", "Xác định hành động xảy ra lúc nào và chia thì thống nhất trong đoạn."),
    "VERB:FORM": ("dạng động từ (nguyên mẫu, to + V, V-ing, V3)", "Sau một số từ (can, to, enjoy, for…) động từ phải ở một dạng nhất định."),
    "VERB:INFL": ("cách chia động từ", "Kiểm tra dạng quá khứ hoặc phân từ của động từ này."),
    "NOUN:NUM": ("dạng số ít / số nhiều của danh từ", "Kiểm tra danh từ đếm được và số lượng đi kèm."),
    "NOUN:POSS": ("sở hữu cách ('s)", "Kiểm tra cách viết sở hữu của danh từ."),
    "NOUN:INFL": ("dạng số nhiều của danh từ", "Một số danh từ có dạng số nhiều đặc biệt."),
    "DET": ("mạo từ hoặc từ hạn định (a, an, the, this, my…)", "Danh từ đếm được số ít thường cần a/an/the hoặc một từ hạn định."),
    "PREP": ("giới từ (in, on, at, to, for…)", "Giới từ thường đi theo cụm cố định; hãy tra cụm từ này."),
    "PRON": ("đại từ (he, she, they, him, them…)", "Kiểm tra đại từ chỉ đúng người hoặc vật và đúng vai trong câu."),
    "CONJ": ("từ nối (and, but, because, so…)", "Kiểm tra quan hệ giữa hai ý được nối."),
    "PART": ("tiểu từ đi với động từ (to, up, off…)", "Một số động từ đi kèm tiểu từ cố định."),
    "ADJ:FORM": ("dạng so sánh của tính từ", "Kiểm tra so sánh hơn / nhất."),
    "MORPH": ("loại từ cùng gốc (danh từ / tính từ / trạng từ…)", "Kiểm tra vị trí này cần danh từ, tính từ hay trạng từ."),
    "PUNCT": ("dấu câu", "Kiểm tra dấu chấm, dấu phẩy và chỗ ngắt câu."),
    "ORTH": ("viết hoa hoặc cách viết liền / tách", "Chữ đầu câu và tên riêng viết hoa; các từ khác viết thường."),
    "SPELL": ("chính tả", "Tra từ điển nếu bạn không chắc cách viết."),
    "WO": ("trật tự từ", "Kiểm tra vị trí của các từ trong câu."),
    "CONTR": ("dạng viết rút gọn", "Kiểm tra dấu nháy và dạng rút gọn."),
    "VERB": ("động từ", "AI đề xuất một động từ khác; hãy cân nhắc từ nào đúng ý bạn."),
    "NOUN": ("danh từ", "AI đề xuất một danh từ khác; hãy cân nhắc từ nào đúng ý bạn."),
    "ADJ": ("tính từ", "AI đề xuất một tính từ khác; hãy cân nhắc từ nào đúng ý bạn."),
    "ADV": ("trạng từ", "AI đề xuất một trạng từ khác; hãy cân nhắc từ nào đúng ý bạn."),
}


def errant_available() -> bool:
    """Cheap check (no model load) used by /health so a missing install is visible."""
    import importlib.util
    if importlib.util.find_spec("errant") is None or importlib.util.find_spec("spacy") is None:
        return False
    import spacy.util
    return spacy.util.is_package("en_core_web_sm")


def _errant():
    """Load ERRANT once; None when it is not installed so explanations fall back to v1."""
    with _ERRANT_LOCK:
        if "annotator" not in _ERRANT_STATE:
            try:
                import errant
                _ERRANT_STATE["annotator"] = errant.load("en")
            except Exception as error:  # missing package or spaCy model
                import logging
                logging.getLogger(__name__).warning(
                    "ERRANT unavailable (%s): explanations fall back to v1. Install requirements-service.txt.", type(error).__name__)
                _ERRANT_STATE["annotator"] = None
        return _ERRANT_STATE["annotator"]


def _token_span(doc, start: int, end: int) -> tuple[int, int]:
    first = next((t.i for t in doc if t.idx + len(t.text) > start), len(doc))
    if start == end:
        return first, first
    last = max((t.i for t in doc if t.idx < end), default=first - 1)
    return first, max(first, last + 1)


def _errant_kind(original: str, suggestion: str, old: tuple[int, int], new: tuple[int, int]):
    annotator = _errant()
    if annotator is None:
        return None
    try:
        orig, cor = annotator.parse(original), annotator.parse(suggestion)
        o_start, o_end = _token_span(orig, *old)
        c_start, c_end = _token_span(cor, *new)
        kind = annotator.import_edit(orig, cor, [o_start, o_end, c_start, c_end], min=False, old_cat=False).type
    except Exception:
        return None
    op, _, category = kind.partition(":")
    old_text, new_text = original[old[0]:old[1]], suggestion[new[0]:new[1]]
    # "Different word" kinds only when the words really differ; near-identical strings are usually a
    # misspelt or broken suggestion (e.g. learn -> learing), which must not be presented as a word choice.
    if category in _WORD_CHOICE and SequenceMatcher(a=old_text.lower(), b=new_text.lower()).ratio() >= 0.75:
        return None
    return (op, category) if category in _KINDS and op in _OPS else None
_TOKENS = re.compile(r"\w+(?:['’]\w+)*|[^\w\s]", re.UNICODE)
_ARTICLES = {"a", "an", "the"}
_MODALS = {"can", "could", "may", "might", "must", "should", "will", "would"}
_SPELLING = {"becuase": "because", "beacuse": "because", "recieve": "receive",
             "freind": "friend", "enviroment": "environment", "langauge": "language",
             "grammer": "grammar", "definately": "definitely", "alot": "a lot"}
_VERBS = {"learn", "watch", "read", "write", "work", "play", "study", "speak", "listen",
          "make", "take", "go", "like", "help", "feel", "need", "want", "use", "improve"}
_PLURALS = {noun: noun + "s" for noun in
            ("book", "month", "year", "day", "word", "skill", "friend", "video", "student", "hour", "minute")}
_COUNTS = {"two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "many", "several"}


def _third_person(verb: str):
    if verb.endswith("y") and len(verb) > 1 and verb[-2] not in "aeiou":
        return verb[:-1] + "ies"
    return verb + ("es" if verb.endswith(("s", "x", "z", "ch", "sh", "o")) else "s")


def _ing_form(verb: str):
    return (verb[:-1] if verb.endswith("e") else verb) + "ing"


def _description(old: str, new: str, left: list[str]):
    """Only emit contextual rules for a small auditable whitelist."""
    a, b = old.casefold(), new.casefold()
    previous = left[-1].casefold() if left else ""
    if _SPELLING.get(a) == b:
        return "SPELL", "Gợi ý sửa cách viết của từ. Hãy kiểm tra từ này có đúng ý bạn muốn diễn đạt."
    if (a in _ARTICLES or not a) and (b in _ARTICLES or not b) and a != b:
        return "ARTICLE", "Gợi ý điều chỉnh mạo từ; cách dùng a, an hoặc the còn phụ thuộc danh từ và ngữ cảnh."
    if _PLURALS.get(a) == b and (previous in _COUNTS or (previous.isdigit() and int(previous) > 1)):
        return "NOUN:NUM", "Sau từ chỉ số lượng lớn hơn một trong cụm này, danh từ đếm được thường dùng dạng số nhiều."
    if previous in _MODALS and b in _VERBS and a == _third_person(b):
        return "VERB:FORM", "Sau động từ khuyết thiếu trong cụm này, dùng động từ nguyên mẫu không to."
    if previous == "of" and a in _VERBS and b == _ing_form(a):
        return "VERB:FORM", "Trong cụm danh từ với of này, gợi ý dùng dạng V-ing cho hành động được nhắc đến."
    if previous in {"he", "she", "it"} and a in _VERBS and b == _third_person(a):
        return "VERB:SVA", "Đề xuất dùng dạng động từ ngôi thứ ba số ít. Hãy kiểm tra câu có diễn tả hiện tại đơn hay không."
    return "OTHER", "Gợi ý thay đổi cách diễn đạt tại vị trí này; chưa có giải thích quy tắc đủ chắc chắn. Hãy kiểm tra lại ngữ cảnh."


def _insert_at(tokens, index: int, text: str) -> int:
    return tokens[index].start() if index < len(tokens) else len(text)


def explain_accepted_change(original: str, suggestion: str) -> list[dict]:
    """Call only AFTER a suggestion passes the application's guard.

    This function does not decide whether the suggestion is grammatical.
    """
    if " ".join(original.split()) == " ".join(suggestion.split()):
        return []
    source, target = list(_TOKENS.finditer(original)), list(_TOKENS.finditer(suggestion))
    changes = [op for op in SequenceMatcher(a=[m.group() for m in source],
                                           b=[m.group() for m in target], autojunk=False).get_opcodes()
               if op[0] != "equal"]
    if len(changes) > 8:
        return [{"category": "OTHER", "original": original, "suggestion": suggestion,
                 "message": "Câu có nhiều thay đổi; hãy đối chiếu toàn bộ câu gốc và câu đề xuất. Chưa có giải thích quy tắc đủ chắc chắn.",
                 "templateVersion": TEMPLATE_VERSION}]
    results = []
    for _, start, end, target_start, target_end in changes:
        old = original[source[start].start():source[end - 1].end()] if start < end else ""
        new = suggestion[target[target_start].start():target[target_end - 1].end()] if target_start < target_end else ""
        category, message = _description(old, new, [m.group() for m in source[:start]])
        version = TEMPLATE_VERSION
        if category == "OTHER":
            old_span = (source[start].start(), source[end - 1].end()) if start < end else (_insert_at(source, start, original),) * 2
            new_span = (target[target_start].start(), target[target_end - 1].end()) if target_start < target_end                 else (_insert_at(target, target_start, suggestion),) * 2
            typed = _errant_kind(original, suggestion, old_span, new_span)
            if typed:
                op, category = typed
                name, tip = _KINDS[category]
                message, version = f"{_OPS[op]} {name} ở chỗ này. {tip}", TEMPLATE_VERSION_V2
        results.append({"category": category, "original": old, "suggestion": new,
                        "message": message, "templateVersion": version})
    return results
