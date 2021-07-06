from collections import Counter

from sudachipy import tokenizer, dictionary

tokenizer_obj = dictionary.Dictionary().create()

def ja_get_text_normal_counts(text):
    result = Counter()
    for m in tokenizer_obj.tokenize(text, tokenizer.Tokenizer.SplitMode.B):
        pos = m.part_of_speech()
        if pos[0] not in ['補助記号', '空白']:
            result[m.normalized_form()] += 1
    return result
