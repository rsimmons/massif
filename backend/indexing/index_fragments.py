import math
import os
import sys
import json
import argparse
import random
from collections import Counter

import requests

from . import fragdb

from ..util.count_chars import count_meaty_chars
from ..common.ja import ja_get_text_morphemes, ja_get_morphemes_normal_stats, ja_get_morphemes_reading, ja_is_repetitive

INDEX_BATCH_SIZE = 1024
MAX_HITS_PER_TAG_SET = 4

def jdump(obj):
    return json.dumps(obj, ensure_ascii=False)

def index_sources_batch(source_rows):
    lines = []

    for source in source_rows:
        assert source['title']
        obj = {
            'title': source['title'],
        }
        if source['pubdate']:
            obj['published'] = source['pubdate']
        if source['url']:
            obj['url'] = source['url']
        if source['tags']:
            obj['tags'] = [t for t in source['tags'].split(',') if t]
        else:
            obj['tags'] = []

        lines.append(jdump({'index': {'_id': source['id']}}) + '\n')
        lines.append(jdump(obj) + '\n')

    data = ''.join(lines)

    if args.print_docs:
        print('SOURCE', data)
    if source_index:
        resp = requests.post(f'http://localhost:9200/{source_index}/_bulk', headers={'Content-Type': 'application/x-ndjson'}, data=data.encode('utf-8'))
        resp.raise_for_status()

def index_fragments_batch(fragments):
    lines = []

    for fragment in fragments:
        lines.append(jdump({'index': {}}) + '\n')
        lines.append(jdump(fragment) + '\n')

    data = ''.join(lines)

    if args.print_docs:
        print('FRAGMENT', data)
    if fragment_index:
        resp = requests.post(f'http://localhost:9200/{fragment_index}/_bulk', headers={'Content-Type': 'application/x-ndjson'}, data=data.encode('utf-8'))
        resp.raise_for_status()

def refresh_index(index):
    resp = requests.post(f'http://localhost:9200/{index}/_refresh')
    resp.raise_for_status()

def flush_accum_sources():
    global accum_sources
    if accum_sources:
        index_sources_batch(accum_sources)
    accum_sources = []

def flush_accum_frags():
    global accum_frags
    if accum_frags:
        index_fragments_batch(accum_frags)
    accum_frags = []

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--print-docs', action='store_true')
    parser.add_argument('--index-suffix')
    parser.add_argument('--normal-stats-file')
    parser.add_argument('sqlite_db')
    args = parser.parse_args()

    fragdb.open(args.sqlite_db)

    if args.index_suffix:
        fragment_index = 'fragment_' + args.index_suffix
        source_index = 'source_' + args.index_suffix
    else:
        fragment_index = None
        source_index = None

    print('INDEXING SOURCES')
    accum_sources = []
    count = 0
    for row in fragdb.iter_sources():
        accum_sources.append(row)
        count += 1
        if (count % INDEX_BATCH_SIZE) == 0:
            flush_accum_sources()
    flush_accum_sources()
    if source_index:
        refresh_index(source_index)

    print('INDEXING FRAGMENTS')
    accum_frags = []
    count = 0
    combined_normal_stats = {}
    for row in fragdb.iter_fragments_plus():
        score = row['logprob']/math.pow(row['count_chars'], 0.5)

        # Map from unique tag-set (sorted, comma-joined into string) to a list of hits with that tag-set.
        # The tag-set string may be the empty string if there are no tags for that hit.
        tag_sets = {}
        for hit in row['hits']:
            tag_set_str = ','.join(sorted(hit['tags'].split(','))) if hit['tags'] else ''
            tag_sets.setdefault(tag_set_str, {'sample': []})
            del hit['tags'] # remove this, since now redundant and don't want to store
            tag_sets[tag_set_str]['sample'].append(hit)

        # Limit how many hits we store for each unique tag-set
        for k, v in tag_sets.items():
            v['count'] = len(v['sample'])
            random.shuffle(v['sample'])
            del v['sample'][MAX_HITS_PER_TAG_SET:] # truncate list in-place

        text = row['text']

        morphemes = ja_get_text_morphemes(text)

        if ja_is_repetitive(text, morphemes):
            continue # skip this fragment

        normal_stats = ja_get_morphemes_normal_stats(morphemes)
        for normal, stats in normal_stats.items():
            combined_normal_stats.setdefault(normal, {
                'c': 0,
                'sc': Counter(), # sub-counts by surface forms
                'dc': Counter(), # sub-counts by dictionary forms
            })
            combined_normal_stats[normal]['c'] += stats['c']
            combined_normal_stats[normal]['sc'].update(stats['sc'])
            combined_normal_stats[normal]['dc'].update(stats['dc'])

        reading = ja_get_morphemes_reading(morphemes)

        accum_frags.append({
            'text': row['text'],
            'normals': list(normal_stats.keys()),
            'reading': reading,
            'mscore': score,
            'tag_sets': list(tag_sets.keys()), # ES can accept an array for any field
            'hits': tag_sets, # store the entire object
        })
        count += 1
        if (count % INDEX_BATCH_SIZE) == 0:
            flush_accum_frags()
    flush_accum_frags()
    if fragment_index:
        refresh_index(fragment_index)

    with open(args.normal_stats_file, 'w') as f:
        f.write(jdump(combined_normal_stats))
