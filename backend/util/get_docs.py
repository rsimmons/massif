import os
import sys
import argparse
import json
import random
from pathlib import Path

import srt
import boto3

if __name__ == '__main__':
    random.seed('massif')

    parser = argparse.ArgumentParser()
    parser.add_argument('--flat', action='store_true')
    parser.add_argument('--semiflat', action='store_true')
    parser.add_argument('s3_prefix')
    args = parser.parse_args()

    assert not (args.flat and args.semiflat)

    s3 = boto3.client('s3')
    bucket = os.getenv('MASSIF_DOCS_BUCKET')

    s3_paginator = s3.get_paginator('list_objects_v2')
    for page in s3_paginator.paginate(Bucket=bucket, Prefix=args.s3_prefix):
        for entry in page['Contents']:
            s3key = entry['Key']

            obj = s3.get_object(Bucket=bucket, Key=s3key)

            doc = json.loads(obj['Body'].read().decode('utf-8'))

            if args.flat:
                fn = s3key.replace('/', '_').replace(' ', '_')
            elif args.semiflat:
                c = s3key.count('/')
                fn = s3key.replace('/', '_', c-1).replace(' ', '_')
                assert fn.count('/') == 1
            else:
                fn = s3key

            # create dirs if necessary
            dir = os.path.dirname(fn)
            Path(dir).mkdir(parents=True, exist_ok=True)

            print('writing file %s' % fn, file=sys.stderr)
            with open(fn, 'w') as f:
                f.write(doc['text'])
