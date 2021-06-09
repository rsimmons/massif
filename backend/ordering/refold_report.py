import sys
import unicodedata
import argparse
from collections import Counter

from sudachi import analyze_single

TOP_WORDS_COUNT = 2000
KNOWN_AHEAD_COUNT = 100
MAX_GOOD_SENTENCES = 20
MAX_NEED_SENTENCES = 20
MAX_LINES_TO_CHECK = 3_000_000

FILTER_NORMALS = '''
は
の
て
に
を
が
た
だ
と
も
で
か
です
な
よ
ない
ね
から
れる
ば
って
ます
けれど
まで
ず
わ
へ
し
ぞ
てる
られる
とく
け
ふっ
ユー
はあはあ
させる
〞
ンンッ
わっ
あっ
ああ
えっ
んっ
はあ
うう
あー
おお
おっ
なあ
うわ
えー
あれ
はっ
うー
えーと
へえ
ふふ
くっ
ねえ
わあ
あはは
あの
む
ふん
いや
いー
ふう
ふふふ
きゃあ
おー
うお
ははは
ぎゃあ
やあ
うふふ
んー
ほう
おっと
えい
えへ
'''

FILTER_NORMALS_SET = set([s.strip() for s in FILTER_NORMALS.split('\n') if s.strip()])

KANA_KANJI_TABLE = dict.fromkeys(i for i in range(sys.maxunicode) if not any((s in unicodedata.name(chr(i), '') for s in ['KATAKANA', 'HIRAGANA', 'CJK'])))
def extract_kana_kanji(text):
    return text.translate(KANA_KANJI_TABLE)

def include_for_refold(analysis):
    (orig, fields_str, normal) = analysis

    if not extract_kana_kanji(orig):
        return False # no Japanese characters

    if fields_str.startswith('名詞,固有名詞,'):
        return False # name

    if normal in FILTER_NORMALS_SET:
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
    parser.add_argument('sortedtoks', help='tsv of (text, toks) sorted by descending goodness')
    parser.add_argument('freqtext', nargs='+', help='may have an integer specified like FN:WEIGHT')
    args = parser.parse_args()

    combined_normal_count = Counter()
    combined_normal_breakdown = {}

    sum_weights = 0
    for freqtext in args.freqtext:
        if ':' in freqtext:
            freqtext_fn, weight_str = freqtext.split(':')
            weight = int(weight_str)
        else:
            weight = 1
            freqtext_fn = freqtext
        sum_weights += weight

        analyses = [a for a in analyze_single(open(freqtext_fn).read()) if include_for_refold(a)]

        normal_count = Counter(normal for (orig, analysis, normal) in analyses)
        total_count = sum(normal_count.values())
        for (normal, count) in normal_count.items():
            combined_normal_count[normal] += weight*(count/total_count)

        normal_breakdown = {}
        for (orig, analysis, normal) in analyses:
            normal_breakdown.setdefault(normal, Counter())
            normal_breakdown[normal][(orig, analysis)] += 1
        for (normal, orig_analysis_counter) in normal_breakdown.items():
            total_count = sum(orig_analysis_counter.values())
            combined_normal_breakdown.setdefault(normal, Counter())
            for (orig_analysis, count) in orig_analysis_counter.items():
                combined_normal_breakdown[normal][orig_analysis] += weight*(count/total_count)

    known_set = FILTER_NORMALS_SET.copy()
    for (normal, _) in combined_normal_count.most_common(KNOWN_AHEAD_COUNT):
        known_set.add(normal)

    print('REPORT OF TOP %d WORDS' % TOP_WORDS_COUNT)
    print('NOTE: It is assumed that the first %d words are known from the beginning, so as to be able to find some sentences.' % KNOWN_AHEAD_COUNT)
    print()

    word_num = 0
    for (normal, count) in combined_normal_count.most_common(TOP_WORDS_COUNT):
        word_num += 1
        print(78*'-')
        print('\t'.join([normal, '#%d, %.6f%% of words' % (word_num, 100*count/sum_weights)]))
        print()

        print('occurs as:')
        for ((orig, fields_str), count) in combined_normal_breakdown[normal].most_common():
            print('  ' + '\t'.join([orig, fields_str, '%.2f%%' % (100*count/sum_weights)]))
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
