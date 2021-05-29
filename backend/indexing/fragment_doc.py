import os
import argparse
import json
import html
import re
import sys
import hashlib
import unicodedata
import sys

import boto3
import srt
import jaconv
from bs4 import BeautifulSoup

from ..util.count_chars import count_meaty_chars, remove_spaces_punctuation

SUBTITLE_CONTINUATION_CHARS = '→➡'

SENT_RE = re.compile(r'[^。！？!?]*[。！？!?]?')

NAME_TAG = re.compile(r'^(【.{1,6}】)|(（.{1,6}）)|(\(.{1,6}\))|(\[.{1,6}\])')

QUOTE_CLOSER = {
    '「': '」',
    '『': '』',
    '〝': '〟',
    '【': '】',
    '（': '）',
    '(': ')',
    '≪': '≫',
    '<': '>',
    '《': '》',
    '｟': '｠',
    '＜': '＞',
    '⦅': '⦆',
    '〈': '〉',
}
ALL_QUOTES = ''.join(k+v for (k, v) in QUOTE_CLOSER.items())

EXEMPT_PUNCT = '。！!？?、…―-・～％%℃,＆' + ALL_QUOTES
WEIRD_PUNCT_TABLE = dict.fromkeys(i for i in range(sys.maxunicode) if (chr(i) in EXEMPT_PUNCT) or not (unicodedata.category(chr(i)).startswith('P') or unicodedata.category(chr(i)).startswith('S')))
def extract_weird_punct(text):
    return text.translate(WEIRD_PUNCT_TABLE)

KANA_KANJI_TABLE = dict.fromkeys(i for i in range(sys.maxunicode) if not any((s in unicodedata.name(chr(i), '') for s in ['KATAKANA', 'HIRAGANA', 'CJK'])))
def extract_kana_kanji(text):
    return text.translate(KANA_KANJI_TABLE)

def has_unbalanced_quotes(text):
    stack = []
    for c in text:
        if c in QUOTE_CLOSER:
            stack.append(c)
        elif stack and (c == QUOTE_CLOSER[stack[-1]]):
            stack.pop()
        elif c in ALL_QUOTES:
            return True

    if stack:
        return True

    return False

def remove_outer_balanced(t):
    if (len(t) >= 2) and (t[0] in QUOTE_CLOSER) and (QUOTE_CLOSER[t[0]] == t[-1]):
        t = t[1:-1]
    return t


def clean_and_divide(text, log_reject):
    assert '\n' not in text

    clean_text = text
    clean_text = jaconv.h2z(clean_text.strip()) # h2z only affects kana by default, which is what we want

    # remove outer matching quotes, brackets, parens
    clean_text = remove_outer_balanced(clean_text)

    sents = [sent.strip() for sent in SENT_RE.findall(clean_text) if sent.strip()]

    cleaned_sents = []
    for sent in sents:
        t = sent

        t = NAME_TAG.sub('', t).strip()
        t = t.lstrip('♬').strip()
        t = t.replace('☎', '').strip()

        t = remove_outer_balanced(t)

        if not t:
            if log_reject: log_reject(text, sent, 'empty')
            continue

        if t.startswith('「') and ('」' not in t):
            t = t[1:]
        if t.startswith('『') and ('』' not in t):
            t = t[1:]

        if t.endswith('」') and ('「' not in t):
            t = t[:-1]
        if t.endswith('』') and ('『' not in t):
            t = t[:-1]

        if t.startswith('」') or t.startswith('』'):
            if log_reject: log_reject(text, sent, 'initclose')
            continue # probably not useful

        if has_unbalanced_quotes(t):
            if log_reject: log_reject(text, sent, 'unbalanced')
            continue

        t = t.lstrip('…―')

        remaining_weird_punct = extract_weird_punct(t)
        if remaining_weird_punct:
            if log_reject: log_reject(text, sent, f'weirdpunct {repr(remaining_weird_punct)}')
            continue

        if not extract_kana_kanji(t):
            continue

        t = t.strip() # important final strip

        cleaned_sents.append(t)

    return cleaned_sents

def fragment_srt(text, log_reject):
    chunks = []

    subs = list(sub for sub in srt.parse(text) if remove_spaces_punctuation(sub.content)) # filter ones with no useful chars, like '♬～'

    accum = [] # accumulate multiple subs if they end with "continuation characters" (arrows)
    frags = []
    for i in range(len(subs)):
        sub = subs[i]
        accum.append(sub)
        # process this accumlated group if no continuation char or we're on last sub
        if (sub.content.strip()[-1] not in SUBTITLE_CONTINUATION_CHARS) or (i == (len(subs)-1)):
            single_line_content = ' '.join(sub.content.strip().rstrip(SUBTITLE_CONTINUATION_CHARS).strip('\r').replace('\n', ' ') for sub in accum)
            start_time = accum[0].start.total_seconds()
            end_time = accum[-1].end.total_seconds()

            frag_texts = clean_and_divide(single_line_content, log_reject)

            for frag_text in frag_texts:
                frags.append({
                    'text': frag_text,
                    'loc': f't:{start_time:.3f}-{end_time:.3f}',
                })

            accum = []

    return frags

def fragment_syosetu(text, log_reject):
    soup = BeautifulSoup(text.strip(), 'html.parser')
    frags = []
    for child in soup.contents[0].children:
        # only consider <p> elements
        # NOTE: we could recurse to find deeper <p> elements, but it doesn't seem necessary so far. could just do elem.descendants
        if child.name == 'p':
            para_text = child.get_text()
            meaty_count = count_meaty_chars(para_text)
            if meaty_count > 0: # skip useless paras
                frag_texts = clean_and_divide(para_text, log_reject)

                for frag_text in frag_texts:
                    frag = {'text': frag_text}
                    if child.has_attr('id'):
                        frag['loc'] = f'a:{child["id"]}'

                    frags.append(frag)

    return frags
