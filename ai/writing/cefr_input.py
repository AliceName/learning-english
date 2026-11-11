"""Conservative operational eligibility, not a CEFR scorer or language detector."""
from collections import Counter
import re
import unicodedata

POLICY_VERSION='cefr-input-v1'


def assess_input(text):
    words=re.findall(r"[^\W\d_]+(?:['’][^\W\d_]+)*",text.casefold(),flags=re.UNICODE)
    word_units=re.findall(r"\w+(?:['’]\w+)*",text,flags=re.UNICODE)
    reasons=[];warnings=[]
    if len(word_units)<5 or not words:
        reasons.append('tooShort')
    elif len(word_units)<30:
        warnings.append('Bài dưới 30 từ; CEFR chỉ là ước lượng trên lượng ngôn ngữ hạn chế.')
    segments=[re.findall(r"[^\W\d_]+",s.casefold()) for s in re.split(r'[.!?]+(?:\s+|$)|[\r\n]+',text)]
    segments=[tuple(s) for s in segments if len(s)>=3]
    repeated=len(segments)>=3 and max(Counter(segments).values())/len(segments)>=.8
    periodic=False
    if len(words)>=24:
        for width in range(3,min(13,len(words)//3+1)):
            if all(word==words[i%width] for i,word in enumerate(words)):
                periodic=True;break
    if len(words)>=12 and (repeated or periodic):reasons.append('repetition')
    letters=[c for c in text if c.isalpha()]
    if len(letters)>=10 and sum('LATIN' not in unicodedata.name(c,'') for c in letters)/len(letters)>=.8:
        reasons.append('unsupportedScript')
    return {'status':'insufficient' if reasons else 'eligible','reasons':reasons,'warnings':warnings,
            'policyVersion':POLICY_VERSION}


def assessment_message(value):
    messages={'tooShort':'Bài có dưới 5 từ; chưa đủ thông tin để ước lượng CEFR. Hãy viết thêm nội dung.',
              'repetition':'Bài lặp lại cùng nội dung quá nhiều; hãy phát triển thêm ý trước khi chấm CEFR.',
              'unsupportedScript':'Phần lớn chữ viết chưa phù hợp với bộ chấm tiếng Anh hiện tại. Hãy nộp bài viết bằng tiếng Anh.'}
    return ' '.join(messages[reason] for reason in value['reasons'])
