import math
import os
import json
import argparse

import requests

import fragdb

INDEX_BATCH_SIZE = 1024

def index_fragments_batch(fragments):
    INDEX_ACTION = json.dumps({'index': {}}) + '\n'
    lines = []
    for fragment in fragments:
        lines.append(INDEX_ACTION)
        lines.append(json.dumps(fragment) + '\n')
    resp = requests.post(f'http://localhost:9200/{fragment_index}/_bulk', headers={'Content-Type': 'application/x-ndjson'}, data=''.join(lines))
    resp.raise_for_status()

def refresh_index(index):
    resp = requests.post(f'http://localhost:9200/{index}/_refresh')
    resp.raise_for_status()

def refresh_indexes():
    refresh_index(fragment_index)

def flush_accum_frags():
    global accum_frags
    if accum_frags:
        index_fragments_batch(accum_frags)
    accum_frags = []

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('sqlite_db')
    parser.add_argument('fragments_table')
    parser.add_argument('index_suffix')
    args = parser.parse_args()

    fragdb.open(args.sqlite_db)

    fragment_index = 'fragment_' + args.index_suffix

    accum_frags = []
    count = 0
    for fragment_row in fragdb.iter_fragments(args.fragments_table):
        (text, logprob, chars, mchars) = fragment_row
        score = logprob/math.pow(chars, 0.5)
        accum_frags.append({'text': text, 'mscore': score})
        count += 1
        if (count % INDEX_BATCH_SIZE) == 0:
            flush_accum_frags()
    flush_accum_frags()

    refresh_indexes()
