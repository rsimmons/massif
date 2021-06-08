import sys
import unicodedata
import argparse
from collections import Counter

from sudachi import analyze_single

TOP_WORDS_COUNT = 1500
KNOWN_AHEAD_COUNT = 100
MAX_GOOD_SENTENCES = 20
MAX_NEED_SENTENCES = 20
MAX_LINES_TO_CHECK = 1_000_000

FILTER_NORMAL_AND_FIRST_FIELD_SET = set([
    ('は', '助詞'),
    ('の', '助詞'),
    ('て', '助詞'),
    ('に', '助詞'),
    ('を', '助詞'),
    ('が', '助詞'),
    ('た', '助動詞'),
    ('だ', '助動詞'),
    ('と', '助詞'),
    ('も', '助詞'),
    ('で', '助詞'),
    ('か', '助詞'),
    ('です', '助動詞'),
    ('な', '助詞'),
    ('よ', '助詞'),
    ('ない', '助動詞'),
    ('ね', '助詞'),
    ('から', '助詞'),
    ('れる', '助動詞'),
    ('ば', '助詞'),
    ('って', '助詞'),
    ('ます', '助動詞'),
    ('けれど', '助詞'),
    ('まで', '助詞'),
    ('ず', '助動詞'),
    ('わ', '助詞'),
    ('へ', '助詞'),
    ('し', '助詞'),
    ('ぞ', '助詞'),
    ('てる', '助動詞'),
    ('られる', '助動詞'),
    ('とく', '助動詞'),
    ('け', '助詞'),
    ('ふっ', '副詞'),
    ('ユー', '名詞'),
    ('はあはあ', '副詞'),
    ('させる', '助動詞'),
    ('〞', '名詞'),
    ('ンンッ', '名詞'),
    ('わっ', '副詞'),

    # 感動詞
    ('あっ', '感動詞'),
    ('ああ', '感動詞'),
    ('えっ', '感動詞'),
    ('んっ', '感動詞'),
    ('はあ', '感動詞'),
    ('うう', '感動詞'),
    ('あー', '感動詞'),
    ('おお', '感動詞'),
    ('おっ', '感動詞'),
    ('なあ', '感動詞'),
    ('うわ', '感動詞'),
    ('えー', '感動詞'),
    ('あれ', '感動詞'),
    ('はっ', '感動詞'),
    ('うー', '感動詞'),
    ('えーと', '感動詞'),
    ('へえ', '感動詞'),
    ('ふふ', '感動詞'),
    ('くっ', '感動詞'),
    ('ねえ', '感動詞'),
    ('わあ', '感動詞'),
    ('あはは', '感動詞'),
    ('あの', '感動詞'),
    ('む', '感動詞'),
    ('ふん', '感動詞'),
    ('いや', '感動詞'),
    ('いー', '感動詞'),
    ('ふう', '感動詞'),
    ('ふふふ', '感動詞'),
    ('きゃあ', '感動詞'),
    ('おー', '感動詞'),
    ('うお', '感動詞'),
    ('ははは', '感動詞'),
    ('ぎゃあ', '感動詞'),
    ('やあ', '感動詞'),
    ('うふふ', '感動詞'),
    ('んー', '感動詞'),
    ('ほう', '感動詞'),
    ('おっと', '感動詞'),
    ('えい', '感動詞'),
])

KANA_KANJI_TABLE = dict.fromkeys(i for i in range(sys.maxunicode) if not any((s in unicodedata.name(chr(i), '') for s in ['KATAKANA', 'HIRAGANA', 'CJK'])))
def extract_kana_kanji(text):
    return text.translate(KANA_KANJI_TABLE)

def include_for_refold(analysis):
    (orig, fields_str, normal) = analysis

    if not extract_kana_kanji(orig):
        return False # no Japanese characters

    if fields_str.startswith('名詞,固有名詞,'):
        return False # name

    fields = fields_str.split(',')
    if (normal, fields[0]) in FILTER_NORMAL_AND_FIRST_FIELD_SET:
        return False

    return True

def find_sentences(target_normal, sorted_toks_fn, known_normals_set):
    # so we can still target a word if it is known
    adjusted_known_normals_set = known_normals_set.copy()
    if target_normal in adjusted_known_normals_set:
        adjusted_known_normals_set.remove(target_normal)

    line_count = 0
    good_sents = []
    need_sents = []
    with open(sorted_toks_fn) as f:
        for line in f:
            line_count += 1
            sline = line.rstrip('\n')

            (text, toks_str) = sline.split('\t')

            toks_set = set(toks_str.split('|')) if toks_str else set()

            unknown_toks = toks_set.difference(adjusted_known_normals_set)

            if target_normal in unknown_toks:
                other_toks = unknown_toks.difference(set([target_normal]))
                all_others_known = (len(other_toks) == 0)
                if all_others_known:
                    good_sents.append(text)
                else:
                    need_sents.append(text + ' missing: ' + ', '.join(other_toks))

            if (len(good_sents) >= MAX_GOOD_SENTENCES) and (len(need_sents) >= MAX_NEED_SENTENCES):
                break
            if line_count >= MAX_LINES_TO_CHECK:
                break

    return (good_sents[:MAX_GOOD_SENTENCES], need_sents[:MAX_NEED_SENTENCES])

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('text')
    parser.add_argument('sortedtoks', help='tsv of (text, toks) sorted by descending goodness')
    args = parser.parse_args()

    analyses = [a for a in analyze_single(open(args.text).read()) if include_for_refold(a)]

    normal_count = Counter(normal for (orig, analysis, normal) in analyses)

    normal_breakdown = {}
    for (orig, analysis, normal) in analyses:
        normal_breakdown.setdefault(normal, Counter())
        normal_breakdown[normal][(orig, analysis)] += 1

    known_set = set()
    for (normal, _) in normal_count.most_common(KNOWN_AHEAD_COUNT):
        known_set.add(normal)

    print('REPORT OF TOP %d WORDS' % TOP_WORDS_COUNT)
    print('NOTE: It is assumed that the first %d words are known from the beginning, so as to be able to find some sentences.' % KNOWN_AHEAD_COUNT)
    print()

    word_num = 0
    for (normal, count) in normal_count.most_common(TOP_WORDS_COUNT):
        word_num += 1
        print(78*'-')
        print('\t'.join([normal, '#%d, occurs %d times' % (word_num, count)]))
        print()

        print('occurs as:')
        for ((orig, fields_str), count) in normal_breakdown[normal].most_common():
            print('  ' + '\t'.join([orig, fields_str, '%d times' % count]))
        print()

        (good_sents, need_sents) = find_sentences(normal, args.sortedtoks, known_set)
        known_set.add(normal)

        print('top sentences using this word where all words known:')
        for s in good_sents:
            print('  ' + s)
        print()

        print('top sentences using this word where NOT all words known:')
        for s in need_sents:
            print('  ' + s)
        print()
