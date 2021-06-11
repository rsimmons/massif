import os
import argparse
import json
import hashlib

import boto3

from . import fragdb
from .fragment_doc import fragment_srt, fragment_syosetu
from ..util.count_chars import count_meaty_chars

def log_reject(text, sent, reason):
    print('\t'.join([reason, sent, text, s3key]), file=reject_file)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--minlen', type=int, default=0)
    parser.add_argument('--maxlen', type=int, default=1000)
    parser.add_argument('sqlite_db')
    parser.add_argument('reject_file')
    parser.add_argument('s3_prefix')
    args = parser.parse_args()

    reject_file = open(args.reject_file, 'x') # x means create only, fail if exists. safety measure

    fragdb.open(args.sqlite_db)

    s3 = boto3.client('s3')
    bucket = os.getenv('MASSIF_DOCS_BUCKET')

    s3_paginator = s3.get_paginator('list_objects_v2')
    for page in s3_paginator.paginate(Bucket=bucket, Prefix=args.s3_prefix):
        for entry in page['Contents']:
            s3key = entry['Key']
            print(s3key)

            obj = s3.get_object(Bucket=bucket, Key=s3key)

            doc = json.loads(obj['Body'].read().decode('utf-8'))

            source_id = hashlib.md5(s3key.encode('utf-8')).hexdigest()

            if s3key.startswith('ja/jpsubbers/'):
                assert doc['type'] == 'application/x-subrip'
                frags = fragment_srt(doc['text'], log_reject)
                tags = 'drama,subs'
            elif s3key.startswith('ja/syosetu/'):
                assert doc['type'] == 'text/html'
                frags = fragment_syosetu(doc['text'], log_reject)
                tags = 'novel,url'
            else:
                assert False

            source = {
                's3key': s3key,
                'title': doc['title'],
                'pubdate': doc.get('published'),
                'url': doc.get('url'),
                'tags' : tags or None,
            }

            located_fragments = []
            for frag in frags:
                clen = count_meaty_chars(frag['text'])
                if (clen >= args.minlen) and (clen <= args.maxlen):
                    located_fragments.append({
                        'text': frag['text'],
                        'count_chars': len(frag['text']),
                        'count_mchars': count_meaty_chars(frag['text']),
                        'loc': frag['loc'],
                    })
            fragdb.insert_source_fragments(source, located_fragments)

