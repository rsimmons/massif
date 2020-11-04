import os
import argparse
import json

import boto3
import srt

from count_chars import count_meaty_chars

# Subtitles will be chunked at gaps of this time or greater, even if they wouldn't otherwise need to
# be because the chunks have little enough text.
SUBTITLE_FORCED_CHUNK_TIME_GAP = 5

SUBTITLE_CONTINUATION_CHARS = '→➡'
SUBTITLE_MAX_CHUNK_CHARS = 80

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
        total_chars += count_meaty_chars(sub.content)
        if prev_sub:
            prev_sub_stripped = prev_sub.content.strip()
            prev_sub_continuation = prev_sub_stripped and (prev_sub_stripped[-1] in SUBTITLE_CONTINUATION_CHARS)
            time_gap = -1 if prev_sub_continuation else (sub.start - prev_sub.end).total_seconds()
            potential_breaks.append((time_gap, total_chars, idx))
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

    return group_subs_list(subs_before) + group_subs_list(subs_after)

def chunk_srt(text):
    subs = list(srt.parse(text))
    grouped_subs = group_subs_list(subs)
    for group in grouped_subs:
        print('BEGIN', len(group), sum(count_meaty_chars(s.content) for s in group))
        for sub in group:
            # print(sub.start.total_seconds(), sub.end.total_seconds())
            print(sub.content.strip())
        print('END')
        print()
    print(len(grouped_subs), 'GROUPS')

def chunk_syosetu(text):
    pass

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
    print(doc)
    print(chunk_doc(args.s3key, doc))
