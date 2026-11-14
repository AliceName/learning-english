"""Conservative Vietnamese descriptions of accepted edits, not correctness proofs.

No corpus, external service, statistical tagger or generated supervision is used.
Fragments are sliced from the original strings, so CRLF and repeated words are
never interpreted as whitespace-normalised M2 offsets.
"""
from __future__ import annotations

from difflib import SequenceMatcher
import re

TEMPLATE_VERSION = "vi-edit-templates-v1"
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
        results.append({"category": category, "original": old, "suggestion": new,
                        "message": message, "templateVersion": TEMPLATE_VERSION})
    return results
