import os
import json
import re
import argparse
import hashlib

import boto3
import srt
import requests

from ja_sent_split import SentenceTokenizer

sentence_tokenizer = SentenceTokenizer()

def eprint(*args, **kwargs):
    print(*args, file=sys.stderr, **kwargs)

def index_metadata(metadata_id, title):
    resp = requests.put(f'http://localhost:9200/ja_sent_meta/_doc/{metadata_id}', json={
        'title': title,
    })
    resp.raise_for_status()

def index_sentences(sentences, tags, metadata_id):
    INDEX_ACTION = json.dumps({'index': {}}) + '\n'
    lines = []
    for sent in sentences:
        lines.append(INDEX_ACTION)
        lines.append(json.dumps({
            'text': sent,
            'tags': tags,
            'mid': metadata_id,
        }) + '\n')
    resp = requests.post('http://localhost:9200/ja_sent_main/_bulk', headers={'Content-Type': 'application/x-ndjson'}, data=''.join(lines))
    resp.raise_for_status()

def refresh_index(index):
    resp = requests.post(f'http://localhost:9200/{index}/_refresh')
    resp.raise_for_status()

def refresh_indexes(index):
    refresh_index('ja_sent_main')
    refresh_index('ja_sent_meta')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('s3prefix')
    args = parser.parse_args()

    s3 = boto3.client('s3')
    bucket = os.getenv('MASSIF_DOCS_BUCKET')

    s3_paginator = s3.get_paginator('list_objects_v2')
    for page in s3_paginator.paginate(Bucket=bucket, Prefix=args.s3prefix):
        for entry in page['Contents']:
            s3key = entry['Key']
            print(s3key)

            obj = s3.get_object(Bucket=bucket, Key=s3key)

            doc = json.loads(obj['Body'].read().decode('utf-8'))

            # print(doc)
            # print()

            metadata_id = hashlib.md5(s3key.encode('utf-8')).hexdigest()

            index_metadata(metadata_id, doc['title'])

            sentences = []

            if doc['type'] == 'application/x-subrip':
                subs = srt.parse(doc['text'])
                for sub in subs:
                    text = sub.content
                    # print(text)
                    # print()
                    sentences.append(text)
            else:
                assert False

            index_sentences(sentences, [], metadata_id)

    refresh_indexes()
