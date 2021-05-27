import os
import argparse
import json
import html
import re
import sys
import hashlib

import boto3
import srt
import jaconv
from bs4 import BeautifulSoup

from ..util.count_chars import count_meaty_chars, remove_spaces_punctuation

SUBTITLE_CONTINUATION_CHARS = '→➡'

SENT_RE = re.compile(r'[^。！…？]*[。！…？]?')

# takes a BS element, returns a list of sentence dicts of its "insides".
# note that we simplify HTML, removing everything except for ruby tags.
def break_into_sentences(elem):
    simple_html = simplified_inner_html(elem)

    split_html = SENT_RE.findall(simple_html)

    sentences = []
    for html in split_html:
        shtml = html.strip()
        if not shtml:
            continue
        text = BeautifulSoup(shtml, 'html.parser').get_text() # hacky but works!
        sentences.append({
            'html': shtml,
            'text': text,
            'chars': count_meaty_chars(text),
        })

    return sentences

# takes a list of sentences. returns a list of list of sentences
def group_sents(sents):
    assert len(sents) > 0
    if len(sents) == 1:
        if sents[0]['chars'] > HTML_REJECT_CHUNK_CHARS:
            # print('SENT REJECT', repr(sents[0]['text']))
            return []
        return [sents]

    potential_breaks = [] # (cumul_chars, before_idx) tuples
    prev_sent = None
    total_chars = 0
    for (idx, sent) in enumerate(sents):
        if prev_sent:
            potential_breaks.append((total_chars, idx))
        total_chars += sent['chars']
        prev_sent = sent

    if total_chars <= HTML_MAX_CHUNK_CHARS:
        return [sents]

    center_char_count = 0.5*total_chars
    potential_breaks.sort(key=lambda b: abs(b[0] - center_char_count))

    split_before_idx = potential_breaks[0][1]

    sents_before = sents[:split_before_idx]
    sents_after = sents[split_before_idx:]

    grouped_sents = group_sents(sents_before) + group_sents(sents_after)

    return grouped_sents

def clean_and_divide(text):
    assert '\n' not in text

    clean_text = jaconv.h2z(text.strip()) # h2z only affects kana by default, which is what we want

    sents = [sent.strip() for sent in SENT_RE.findall(clean_text) if sent.strip()]

    return sents

def fragment_srt(text):
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

            frag_texts = clean_and_divide(single_line_content)

            for frag_text in frag_texts:
                frags.append({
                    'text': frag_text,
                    'loc': f't:{start_time:.3f}-{end_time:.3f}',
                })

            accum = []

    return frags

def fragment_syosetu(text):
    soup = BeautifulSoup(text.strip(), 'html.parser')
    frags = []
    for child in soup.contents[0].children:
        # only consider <p> elements
        # NOTE: we could recurse to find deeper <p> elements, but it doesn't seem necessary so far. could just do elem.descendants
        if child.name == 'p':
            para_text = child.get_text()
            meaty_count = count_meaty_chars(para_text)
            if meaty_count > 0: # skip useless paras
                frag_texts = clean_and_divide(para_text)

                for frag_text in frag_texts:
                    frag = {'text': frag_text}
                    if child.has_attr('id'):
                        frag['loc'] = f'a:{child["id"]}'

                    frags.append(frag)

    return frags

def add_meta(s3key, tags, frags):
    for frag in frags:
        frag['src'] = metadata_id = hashlib.md5(s3key.encode('utf-8')).hexdigest()
        frag['tags'] = tags

def fragment_doc(s3key, doc):
    if s3key.startswith('ja/jpsubbers/'):
        assert doc['type'] == 'application/x-subrip'
        return add_meta(s3key, 'drama,subs', fragment_srt(doc['text']))
    elif s3key.startswith('ja/syosetu/'):
        assert doc['type'] == 'text/html'
        return add_meta(s3key, 'novel', fragment_syosetu(doc['text']))
    else:
        assert False

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('s3key')
    args = parser.parse_args()

    s3 = boto3.client('s3')
    bucket = os.getenv('MASSIF_DOCS_BUCKET')

    obj = s3.get_object(Bucket=bucket, Key=args.s3key)
    doc = json.loads(obj['Body'].read().decode('utf-8'))
    print('DOC------------------------------------')
    print(doc)
    print('FRAGS----------------------------------')
    for frag in fragment_doc(args.s3key, doc):
        print(repr(frag))
