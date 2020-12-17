import os
import argparse
import json
import html
import re
import sys

import boto3
import srt
import jaconv
from bs4 import BeautifulSoup

from count_chars import count_meaty_chars, remove_spaces_punctuation

# Subtitles will be chunked at gaps of this time or greater, even if they wouldn't otherwise need to
# be because the chunks have little enough text.
SUBTITLE_FORCED_CHUNK_TIME_GAP = 5

SUBTITLE_CONTINUATION_CHARS = '→➡'
SUBTITLE_MAX_CHUNK_CHARS = 80

HTML_MAX_CHUNK_CHARS = 80
HTML_REJECT_CHUNK_CHARS = 2*HTML_MAX_CHUNK_CHARS

def flatten_list_of_lists(l):
    return [item for sublist in l for item in sublist]

# Takes list of Subtitle, returns list of lists
# We force a chunk split for any time gap above a certain threshold.
# Otherwise, we recursively split chunks until they are either a single subtitle, or below a certain
# number of (non-space/punct) characters.
# We split chunks at the largest time gap between subtitles. We treat subtitles with "continuation"
# arrows as negative to make them even less likely to split.
# If there is a tie with time gaps (as often happens if all the gaps are zero), then we try to
# split to make the resulting character counts as even as possible.
def group_subs_list(subs):
    assert len(subs) > 0
    if len(subs) == 1:
        return [subs]

    potential_breaks = [] # (time_gap, cumul_chars, before_idx) tuples

    prev_sub = None
    total_chars = 0
    for (idx, sub) in enumerate(subs):
        if prev_sub:
            prev_sub_stripped = prev_sub.content.strip()
            prev_sub_continuation = prev_sub_stripped and (prev_sub_stripped[-1] in SUBTITLE_CONTINUATION_CHARS)
            time_gap = -1 if prev_sub_continuation else (sub.start - prev_sub.end).total_seconds()
            potential_breaks.append((time_gap, total_chars, idx))
        total_chars += count_meaty_chars(sub.content)
        prev_sub = sub

    potential_breaks.sort(reverse=True)

    biggest_gap = potential_breaks[0][0]

    if biggest_gap < SUBTITLE_FORCED_CHUNK_TIME_GAP and total_chars <= SUBTITLE_MAX_CHUNK_CHARS:
        # don't need to split any further
        return [subs]

    ties = [b for b in potential_breaks if b[0] == biggest_gap]

    center_char_count = 0.5*total_chars
    ties.sort(key=lambda b: abs(b[1] - center_char_count))

    split_before_idx = ties[0][2]

    subs_before = subs[:split_before_idx]
    subs_after = subs[split_before_idx:]

    grouped_subs = group_subs_list(subs_before) + group_subs_list(subs_after)

    # sanity check: flatten groups and make sure it matches original
    flattened_groups = flatten_list_of_lists(grouped_subs)
    assert len(flattened_groups) == len(subs)
    for (i, s) in enumerate(flattened_groups):
        assert s is subs[i]

    return grouped_subs

def chunk_srt(text):
    chunks = []

    subs = list(sub for sub in srt.parse(text) if remove_spaces_punctuation(sub.content)) # filter ones with no useful chars, like '♬～'

    grouped_subs = group_subs_list(subs)

    for group in grouped_subs:
        text_pieces = []
        html_pieces = []

        for sub in group:
            start_time = sub.start.total_seconds()
            end_time = sub.end.total_seconds()

            cleaned_content = jaconv.h2z(sub.content).strip() # h2z only affects kana by default, which is what we want

            text_pieces.append(cleaned_content)

            html_pieces.append(
                f'<p t0="{start_time:.3f}" t1="{end_time:.3f}">' +
                html.escape(cleaned_content).replace('\n', '<br>') +
                f'</p>'
            )

        chunks.append({
            'text': '\n'.join(text_pieces),
            'html': '\n'.join(html_pieces),
        })

    return chunks

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

# takes a list of paragraphs, returns a list of list of paragraphs (or potentially, sub-paragraph fragments if we have to split paras)
def group_split_paras(paras):
    assert len(paras) > 0
    if len(paras) == 1:
        if paras[0]['chars'] <= HTML_MAX_CHUNK_CHARS:
            return [[paras[0]]]
        sent_groups = group_sents(paras[0]['sents'])
        para_groups = []
        for sent_group in sent_groups:
            para = {
                'sents': sent_group,
                'chars': sum(sent['chars'] for sent in sent_group),
            }
            if paras[0].get('anchor'):
                para['anchor'] = paras[0]['anchor']
            para_groups.append([para])
        return para_groups

    potential_breaks = [] # (cumul_chars, before_idx) tuples
    prev_para = None
    total_chars = 0
    for (idx, para) in enumerate(paras):
        if prev_para:
            potential_breaks.append((total_chars, idx))
        total_chars += para['chars']
        prev_para = para

    if total_chars <= HTML_MAX_CHUNK_CHARS:
        return [paras]

    center_char_count = 0.5*total_chars
    potential_breaks.sort(key=lambda b: abs(b[0] - center_char_count))

    split_before_idx = potential_breaks[0][1]

    paras_before = paras[:split_before_idx]
    paras_after = paras[split_before_idx:]

    grouped_paras = group_split_paras(paras_before) + group_split_paras(paras_after)

    return grouped_paras

# given a list of paragraphs, return a list of chunks.
# a chunk has an 'html' field
def chunks_from_paras(paras):
    if not paras:
        return []

    chunks = []
    groups = group_split_paras(paras)
    for group in groups:
        html_pieces = []
        text_pieces = []

        for para in group:
            para_text = ''.join(sent['text'] for sent in para['sents'])
            para_html = ''.join(sent['html'] for sent in para['sents'])
            text_pieces.append(para_text)
            if para.get('anchor'):
                html_pieces.append(f'<p a="{para["anchor"]}">{para_html}</p>')
            else:
                html_pieces.append(f'<p>{para_html}</p>')

        chunks.append({
            'html': '\n'.join(html_pieces),
            'text': '\n'.join(text_pieces)
        })

    return chunks

def assert_safe_ruby(elem):
    if elem.name is None:
        assert '。' not in str(elem)
        return
    assert elem.name in ['ruby', 'rb', 'rp', 'rt']
    for child in elem.children:
        assert_safe_ruby(child)

# takes a BS element, returns an HTML string that has most tags removed,
# with the notable exception of <ruby> stuff
def simplified_inner_html(elem):
    if elem.name is None:
        return html.escape(str(elem))

    pieces = []
    for e in elem.children:
        if e.name == 'ruby':
            pieces.append(str(e))
        else:
            pieces.append(simplified_inner_html(e))

    return ''.join(pieces)

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

def chunk_html_p_children(elem):
    accum_paras = []
    accum_chunks = []
    for child in elem.children:
        # only consider <p> elements
        # NOTE: we could recurse to find deeper <p> elements, but it doesn't seem necessary so far. could just do elem.descendants
        if child.name == 'p':
            meaty_count = count_meaty_chars(child.get_text())
            if meaty_count == 0:
                # force a break between chunks when we encounter paragraphs with no meaty characters,
                # which for syosetu may be just a <br> (empty line) or something like ~~~~
                accum_chunks.extend(chunks_from_paras(accum_paras))
                accum_paras = []
            else:
                para = {
                    'sents': break_into_sentences(child),
                    'chars': meaty_count,
                }
                assert sum(sent['chars'] for sent in para['sents']) == meaty_count
                if child.has_attr('id'):
                    para['anchor'] = child['id']
                accum_paras.append(para)

    accum_chunks.extend(chunks_from_paras(accum_paras))
    accum_paras = []

    return accum_chunks

def chunk_syosetu(text):
    soup = BeautifulSoup(text, 'html.parser')
    return chunk_html_p_children(soup.contents[0])

def chunk_doc(s3key, doc):
    mode = None
    if s3key.startswith('ja/jpsubbers/'):
        assert doc['type'] == 'application/x-subrip'
        return chunk_srt(doc['text'])
    elif s3key.startswith('ja/syosetu/'):
        assert doc['type'] == 'text/html'
        return chunk_syosetu(doc['text'])
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
    # print(doc)
    for chunk in chunk_doc(args.s3key, doc):
        print('CHUNK')
        print('HTML')
        print(chunk['html'])
        print('TEXT')
        print(chunk['text'])
