import sys
import unicodedata
import argparse
import json
from collections import Counter

from sudachi import analyze_single

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

if __name__ == '__main__':
    sys.stdin.reconfigure(encoding='utf-8')

    parser = argparse.ArgumentParser()
    parser.add_argument('--limit', type=int)
    parser.add_argument('--name')
    args = parser.parse_args()

    combined_normal_count = Counter()

    analyses = [a for a in analyze_single(sys.stdin.read()) if include_for_refold(a)]

    normal_count = Counter(normal for (orig, analysis, normal) in analyses)
    for (normal, count) in normal_count.items():
        combined_normal_count[normal] += count

    obj = {
        'top_words': []
    }

    if args.name:
        obj['name'] = args.name

    for (normal, count) in combined_normal_count.most_common(args.limit):
        obj['top_words'].append({
            'w': normal,
            'c': count,
        })

    json.dump(obj, sys.stdout, sort_keys=True, ensure_ascii=False)
    print()
