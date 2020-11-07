import os
import json
import re
import argparse
import hashlib

import boto3
import srt
import requests

from ja_sent_split import SentenceTokenizer
from chunk_doc import chunk_doc

sentence_tokenizer = SentenceTokenizer()

def eprint(*args, **kwargs):
    print(*args, file=sys.stderr, **kwargs)

def index_metadata(metadata_id, title, published, url):
    assert title and published
    obj = {
        'title': title,
        'published': published,
    }
    if url:
        obj['url'] = url
    resp = requests.put(f'http://localhost:9200/{meta_index}/_doc/{metadata_id}', json=obj)
    resp.raise_for_status()

def index_chunks(chunks, tags, metadata_id):
    INDEX_ACTION = json.dumps({'index': {}}) + '\n'
    lines = []
    for chunk in chunks:
        lines.append(INDEX_ACTION)
        lines.append(json.dumps({
            'html': chunk['html'],
            'tags': tags,
            'mid': metadata_id,
        }) + '\n')
    resp = requests.post(f'http://localhost:9200/{chunk_index}/_bulk', headers={'Content-Type': 'application/x-ndjson'}, data=''.join(lines))
    resp.raise_for_status()

def refresh_index(index):
    resp = requests.post(f'http://localhost:9200/{index}/_refresh')
    resp.raise_for_status()

def refresh_indexes():
    refresh_index(chunk_index)
    refresh_index(meta_index)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('index_prefix')
    parser.add_argument('s3_prefix')
    args = parser.parse_args()

    chunk_index = 'chunk_' + args.index_prefix
    meta_index = 'meta_' + args.index_prefix

    s3 = boto3.client('s3')
    bucket = os.getenv('MASSIF_DOCS_BUCKET')

    s3_paginator = s3.get_paginator('list_objects_v2')
    for page in s3_paginator.paginate(Bucket=bucket, Prefix=args.s3_prefix):
        for entry in page['Contents']:
            s3key = entry['Key']
            print(s3key)

            obj = s3.get_object(Bucket=bucket, Key=s3key)

            doc = json.loads(obj['Body'].read().decode('utf-8'))

            metadata_id = hashlib.md5(s3key.encode('utf-8')).hexdigest()

            index_metadata(metadata_id, doc['title'], doc['published'], doc.get('url'))

            chunks = chunk_doc(s3key, doc)

            tags = doc.get('tags', [])
            if s3key.startswith('ja/jpsubbers/'):
                tags.append('drama')
            elif s3key.startswith('ja/syosetu/'):
                tags.append('novel')
                tags.append('url')
            else:
                assert False

            index_chunks(chunks, tags, metadata_id)

    refresh_indexes()
