import sys
import re
from collections import Counter

from sudachipy import tokenizer, dictionary
from diff_match_patch import diff_match_patch
import jaconv

dmp = diff_match_patch()

tokenizer_obj = dictionary.Dictionary().create()

KANJI_RE = re.compile(r'[一-龯]')
def has_any_kanji(s):
    return bool(KANJI_RE.search(s))

NUMERALS_RE = re.compile('[0-9０-９]')
def has_any_numerals(s):
    return bool(NUMERALS_RE.search(s))

def ignore_morpheme(m):
    return m.part_of_speech() in ['補助記号', '空白']

def ja_get_text_normal_counts(text):
    result = Counter()
    for m in tokenizer_obj.tokenize(text, tokenizer.Tokenizer.SplitMode.B):
        if not ignore_morpheme(m):
            result[m.normalized_form()] += 1
    return result

def ja_get_morphemes_reading(morphemes):
    result = ''

    for m in morphemes:
        pos = m.part_of_speech()
        surface = m.surface()
        if (not m.reading_form()) or (not (has_any_kanji(surface) or has_any_numerals(surface))):
            # If there isn't any reading form (for stuff like 'foo')
            # or there aren't any kanji or numerals,
            # then just copy the surface form.
            # This avoids weird bugs where the reading doesn't really match the surface.
            result += surface
        else:
            kata_surface = jaconv.hira2kata(surface)
            diff = dmp.diff_main(kata_surface, m.reading_form())
            # print('DIFF', repr(kata_surface), repr(m.reading_form()), diff)
            i = 0
            cidx = 0
            while i < len(diff):
                op, t = diff[i]
                if op == 0:
                    result += surface[cidx:][:len(t)]
                    i += 1
                    cidx += len(t)
                else:
                    assert op == -1
                    assert (i + 1) < len(diff)
                    next_op, next_t = diff[i+1]
                    assert next_op == 1

                    result += (' ' if result else '') + t + '[' + jaconv.kata2hira(next_t) + ']'
                    i += 2
                    cidx += len(t)

    return result

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
        # raise
        reading = '' # TODO: revisit

    return normals_set, reading

if __name__ == '__main__':
    TEST_READING_FRAGMENTS = [
        ('?', '?'),
        ('.', '.'),
        ('foo', 'foo'),
        ('そうです。', 'そうです。'),
        ('様々', '様々[さまざま]'),
        ('繰り返す', '繰[く]り 返[かえ]す'),
        ('飛ばねぇ豚はただの豚だ', '飛[と]ばねぇ 豚[ぶた]はただの 豚[ぶた]だ'),
        ('ぶっ殺した', 'ぶっ 殺[ころ]した'),
        ('アップした', 'アップした'),
        ('これ。\nそれ。。\nあれ。\r\n', 'これ。\nそれ。。\nあれ。\r\n'),
        ('えええええええええええーーーーーーーーーーーーーっ！', 'えええええええええええーーーーーーーーーーーーーっ！'),
        ('１つ', '１[ひと]つ'),
        ('２人', '２人[ふたり]'),
        ('言い聞かせる', '言[い]い 聞[き]かせる'),
        ('聞き込みをしているうちに、', '聞[き]き　込[こ]みをしているうちに、'),
        ('どうやら相当の思い入れがあったらしい。', 'どうやら　相当[そうとう]の　思[おも]い　入[い]れがあったらしい。'),
        ('何か喋っているようだが内容までは聞き取れない。', '何[なに]か 喋[しゃべ]っているようだが 内容[ないよう]までは 聞[き]き 取[と]れない。'),

        # ('差し出がましい', '差[さ]し出[で]がましい'), # Sudachi currently gets this wrong, not our fault
    ]
    for frag, target_reading in TEST_READING_FRAGMENTS:
        print('testing', repr(frag))
        normals_set, reading = ja_get_text_normals_and_reading(frag)
        assert reading == target_reading, repr(reading)
    print('ALL GOOD')
