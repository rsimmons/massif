import sys
import re
from collections import Counter

from sudachipy import tokenizer, dictionary
import jaconv

tokenizer_obj = dictionary.Dictionary().create()

KANJI_RE = re.compile(r'[一-龯]')
def has_any_kanji(s):
    return bool(KANJI_RE.search(s))

NUMERALS_RE = re.compile('[0-9０-９]')
def has_any_numerals(s):
    return bool(NUMERALS_RE.search(s))

def char_could_have_reading(c):
    return has_any_kanji(c) or has_any_numerals(c) or c in '々〇カケヵヶぁぃぅぇぉァィゥェォ'

# KATAKANA_RE = re.compile(r'[ァ-ー]')
# def has_any_katakana(c):
#     return bool(KATAKANA_RE.search(s))

def ignore_morpheme(m):
    return m.part_of_speech() in ['補助記号', '空白']

def ja_get_text_normal_counts(text):
    result = Counter()
    for m in tokenizer_obj.tokenize(text, tokenizer.Tokenizer.SplitMode.B):
        if not ignore_morpheme(m):
            result[m.normalized_form()] += 1
    return result

# returns text with furigana in "Anki format", readings converted to hiragana
def ja_match_furigana(kanji_text, kana_text, not_start):
    # We use a non-recursive DFS, storing an explicit stack
    len_kanji_text = len(kanji_text)
    len_kana_text = len(kana_text)
    stack = [{
        'kanji_idx': 0,
        'kana_idx': 0,
        'result': '',
        'accum_kana': '',
    }]

    while stack:
        top = stack.pop()
        kanji_idx = top['kanji_idx']
        kana_idx = top['kana_idx']
        result = top['result']
        accum_kana = top['accum_kana']
        if kanji_idx == len_kanji_text:
            if kana_idx == len_kana_text:
                # we found a match!
                assert not accum_kana
                return result
            else:
                # dead end
                pass
        else:
            if kana_idx == len_kana_text:
                # dead end
                pass
            else:
                kanji_char = kanji_text[kanji_idx]
                kana_char = kana_text[kana_idx]
                norm_kanji_char = jaconv.hira2kata(kanji_char)
                norm_kana_char = jaconv.hira2kata(kana_char)
                if (norm_kanji_char == norm_kana_char) or \
                  ((norm_kanji_char == 'ハ') and (norm_kana_char == 'ワ')) or \
                  ((norm_kanji_char == 'ヂ') and (norm_kana_char == 'ジ')) or \
                  ((norm_kanji_char == 'ヅ') and (norm_kana_char == 'ズ')):
                    assert not accum_kana
                    stack.append({
                        'kanji_idx': kanji_idx + 1,
                        'kana_idx': kana_idx + 1,
                        'result': result + kanji_char,
                        'accum_kana': '',
                    })
                elif char_could_have_reading(kanji_char):
                    # we didn't check if kana_char is actually kana (as opposed to punctuation)
                    # because analyzer should make those into separate morphemes

                    # find the next index after the end of the kanji run
                    after_run_idx = kanji_idx + 1
                    while (after_run_idx < len_kanji_text) and char_could_have_reading(kanji_text[after_run_idx]):
                        after_run_idx += 1

                    # NOTE: The order that we push onto the stack is extremely important to not have horrible performance

                    stack.append({
                        'kanji_idx': kanji_idx,
                        'kana_idx': kana_idx + 1,
                        'result': result,
                        'accum_kana': accum_kana + kana_text[kana_idx],
                    })

                    stack.append({
                        'kanji_idx': after_run_idx,
                        'kana_idx': kana_idx + 1,
                        'result': result + (' ' if (not_start or result) else '') + kanji_text[kanji_idx:after_run_idx] + '[' + jaconv.kata2hira(accum_kana + kana_text[kana_idx]) + ']',
                        'accum_kana': '',
                    })

    # print('NO MATCHES', repr(kanji_text), repr(kana_text))
    # We occasionally don't match in weird cases, but that's OK
    return kanji_text

ADJUSTED_READINGS = {
    '日本': (['名詞', '固有名詞', '地名', '国', '*', '*'], '日本[にほん]'),
    '私': (['代名詞', '*', '*', '*', '*', '*'], '私[わたし]'),
}

def ja_get_morphemes_reading(morphemes):
    result_pieces = []

    for m in morphemes:
        pos = m.part_of_speech()
        surface = m.surface()
        if (surface in ADJUSTED_READINGS) and all(x == y for (x, y) in zip(pos, ADJUSTED_READINGS[surface][0])):
            result_pieces.append((' ' if result_pieces else '') + ADJUSTED_READINGS[surface][1])
        elif (not m.reading_form()) or (not (has_any_kanji(surface) or has_any_numerals(surface))):
            # If there isn't any reading form (for stuff like 'foo')
            # or there aren't any kanji or numerals,
            # then just copy the surface form.
            # This avoids weird bugs where the reading doesn't really match the surface.
            result_pieces.append(surface)
        else:
            result_pieces.append(ja_match_furigana(surface, m.reading_form(), bool(result_pieces)))

    return ''.join(result_pieces)

def ja_get_text_normals_and_reading(text):
    normals_set = set()

    morphemes = tokenizer_obj.tokenize(text, tokenizer.Tokenizer.SplitMode.B)

    for m in morphemes:
        if not ignore_morpheme(m):
            normals_set.add(m.normalized_form())

    try:
        reading = ja_get_morphemes_reading(morphemes)
    except:
        print('ERROR getting reading of', repr(text), file=sys.stderr)
        raise

    return normals_set, reading

if __name__ == '__main__':
    TEST_READING_FRAGMENTS = [
        ('?', '?'),
        ('.', '.'),
        ('foo', 'foo'),
        ('そうです。', 'そうです。'),
        ('様々', '様々[さまざま]'),
        ('可愛い', '可愛[かわい]い'),
        ('繰り返す', '繰[く]り 返[かえ]す'),
        ('飛ばねぇ豚はただの豚だ', '飛[と]ばねぇ 豚[ぶた]はただの 豚[ぶた]だ'),
        ('ぶっ殺した', 'ぶっ 殺[ころ]した'),
        ('アップした', 'アップした'),
        ('これ。\nそれ。。\nあれ。\r\n', 'これ。\nそれ。。\nあれ。\r\n'),
        ('えええええええええええーーーーーーーーーーーーーっ！', 'えええええええええええーーーーーーーーーーーーーっ！'),
        ('１つ', '１[ひと]つ'),
        ('２人', '２人[ふたり]'),
        ('五〇歳', '五〇[ごれい] 歳[さい]'),
        ('ここ一ヶ月', 'ここ 一[いち] ヶ月[かげつ]'), # we would prefer いっかげつ of course..
        ('鏡は無ぇみてぇだなァ', '鏡[かがみ]は 無ぇ[ねえ]みてぇだなァ'),
        ('或は', '或[あるい]は'),
        ('小ぢんまり', '小[こ]ぢんまり'),

        # the following failed with the old algorithm based on diff_match_patch
        ('言い聞かせる', '言[い]い 聞[き]かせる'),
        ('聞き込みをしているうちに、', '聞[き]き 込[こ]みをしているうちに、'),
        ('どうやら相当の思い入れがあったらしい。', 'どうやら 相当[そうとう]の 思[おも]い 入[い]れがあったらしい。'),
        ('何か喋っているようだが内容までは聞き取れない。', '何[なん]か 喋[しゃべ]っているようだが 内容[ないよう]までは 聞[き]き 取[と]れない。'),
        # ('差し出がましい', '差[さ]し出[で]がましい'), # Sudachi currently gets this wrong, not our fault

        # these readings we have special cased because they will be so counterintuitive for learners,
        ('日本', '日本[にほん]'),
        ('これは私のです', 'これは 私[わたし]のです'),
    ]
    for frag, target_reading in TEST_READING_FRAGMENTS:
        print('testing', repr(frag))
        normals_set, reading = ja_get_text_normals_and_reading(frag)
        assert reading == target_reading, (repr(reading) + ' vs ' + repr(target_reading))
    print('ALL GOOD')
