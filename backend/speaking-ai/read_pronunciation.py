"""Choose the reference pronunciation of the homograph read from text cues."""
import re


WORD_PATTERN = re.compile(r"[A-Za-z]+(?:['’][A-Za-z]+)*")
CLAUSE_BREAK = re.compile(r"[;.!?]|,\s*(?:and|but|so|yet|or)\b", re.IGNORECASE)
PAST_TIME = re.compile(r"\b(?:yesterday|ago|the other day|last (?:night|week|month|year|weekend|summer|winter|spring|autumn|fall|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b")
PERFECT = set("have has had haven't hasn't hadn't i've you've we've they've he's she's it's".split())
BASE_FORM = set("to do does did don't doesn't didn't can could may might must shall should will would cannot can't couldn't mustn't shouldn't won't wouldn't".split())
SUBJECTS = set("i you he she it we they".split())
ADVERBS = set("not never already just recently often usually always sometimes still only really also ever finally all".split())
QUESTION_WORDS = set("what which who where when why how".split())


def phonetic_spellings(words, sentence_text, start_word_index=0):
    """Use red/reed only for G2P. Keep the original words for scoring output."""
    spellings = [word.lower() for word in words]
    matches = list(WORD_PATTERN.finditer(sentence_text))
    context = [match.group().lower().replace('’', "'") for match in matches]
    if start_word_index < 0 or context[start_word_index:start_word_index + len(words)] != spellings:
        raise ValueError('The reference does not match the sentence at the supplied word offset.')

    for index, word in enumerate(spellings):
        if word != 'read':
            continue
        position = matches[start_word_index + index].start()
        before = CLAUSE_BREAK.split(sentence_text[:position])[-1].lower().replace('’', "'")
        after = CLAUSE_BREAK.split(sentence_text[position:], maxsplit=1)[0].lower()
        prior_words = WORD_PATTERN.findall(before)
        while prior_words and prior_words[-1] in ADVERBS:
            prior_words.pop()
        previous = prior_words[-1] if prior_words else ''
        helper = previous
        if previous in SUBJECTS and len(prior_words) >= 2 and (len(prior_words) == 2 or prior_words[0] in QUESTION_WORDS):
            helper = prior_words[-2]
        if helper in PERFECT:
            spellings[index] = 'red'
        elif helper in BASE_FORM or helper.endswith("'ll"):
            spellings[index] = 'reed'
        elif previous in SUBJECTS and PAST_TIME.search(' '.join((before + after).split())):
            spellings[index] = 'red'
    return spellings
