import math
import os
import json
import argparse
import random

import requests

import fragdb

INDEX_BATCH_SIZE = 1024
MAX_HITS_PER_TAG_SET = 4

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

        lines.append(json.dumps({'index': {'_id': source['id']}}) + '\n')
        lines.append(json.dumps(obj) + '\n')

    resp = requests.post(f'http://localhost:9200/{source_index}/_bulk', headers={'Content-Type': 'application/x-ndjson'}, data=''.join(lines))
    resp.raise_for_status()

def index_fragments_batch(fragments):
    lines = []
    for fragment in fragments:
        lines.append(json.dumps({'index': {}}) + '\n')
        lines.append(json.dumps(fragment) + '\n')
    resp = requests.post(f'http://localhost:9200/{fragment_index}/_bulk', headers={'Content-Type': 'application/x-ndjson'}, data=''.join(lines))
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
    parser.add_argument('sqlite_db')
    parser.add_argument('index_suffix')
    args = parser.parse_args()

    fragdb.open(args.sqlite_db)

    fragment_index = 'fragment_' + args.index_suffix
    source_index = 'source_' + args.index_suffix

    # Can we do them all in one big batch?
    print('INDEXING SOURCES')
    accum_sources = []
    count = 0
    for row in fragdb.iter_sources():
        accum_sources.append(row)
        count += 1
        if (count % INDEX_BATCH_SIZE) == 0:
            flush_accum_sources()
    flush_accum_sources()
    refresh_index(source_index)

    print('INDEXING FRAGMENTS')
    accum_frags = []
    count = 0
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

        accum_frags.append({
            'text': row['text'],
            'mscore': score,
            'tag_sets': list(tag_sets.keys()), # ES can accept an array for any field
            'hits': tag_sets, # store the entire object
        })
        count += 1
        if (count % INDEX_BATCH_SIZE) == 0:
            flush_accum_frags()
    flush_accum_frags()
    refresh_index(fragment_index)
