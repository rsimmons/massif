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
    parser.add_argument('s3_prefix')
    args = parser.parse_args()

    s3 = boto3.client('s3')
    bucket = os.getenv('MASSIF_DOCS_BUCKET')

    s3_paginator = s3.get_paginator('list_objects_v2')
    for page in s3_paginator.paginate(Bucket=bucket, Prefix=args.s3_prefix):
        for entry in page['Contents']:
            s3key = entry['Key']

            obj = s3.get_object(Bucket=bucket, Key=s3key)

            doc = json.loads(obj['Body'].read().decode('utf-8'))

            fn = s3key.replace('/', '_').replace(' ', '_')
            print('writing file %s' % fn, file=sys.stderr)
            with open(fn, 'w') as f:
                f.write(doc['text'])
