import os
import sys
import argparse
import json
import hashlib
import random

import srt
import boto3

if __name__ == '__main__':
    random.seed('massif')

    parser = argparse.ArgumentParser()
    parser.add_argument('--count', type=int, default=10)
    parser.add_argument('s3_prefix')
    args = parser.parse_args()

    s3 = boto3.client('s3')
    bucket = os.getenv('MASSIF_DOCS_BUCKET')

    matching_keys = []

    s3_paginator = s3.get_paginator('list_objects_v2')
    for page in s3_paginator.paginate(Bucket=bucket, Prefix=args.s3_prefix):
        for entry in page['Contents']:
            s3key = entry['Key']
            matching_keys.append(s3key)

    print('found %d matching keys' % len(matching_keys), file=sys.stderr)
    random.shuffle(matching_keys)

    for key in matching_keys[:args.count]:
        obj = s3.get_object(Bucket=bucket, Key=key)

        doc = json.loads(obj['Body'].read().decode('utf-8'))

        fn = key.replace('/', '_').replace(' ', '_')
        print('writing file %s' % fn, file=sys.stderr)
        with open(fn, 'w') as f:
            f.write(doc['text'])
