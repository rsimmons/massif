import sys
import os
import glob
import json
import re
import argparse
from datetime import datetime
from zipfile import ZipFile
from collections import OrderedDict

import boto3

SP_DATE_RE = re.compile(r'\(([0-9]{4})\.([0-9]{2})\.([0-9]{2})\)')

def eprint(*args, **kwargs):
    print(*args, file=sys.stderr, **kwargs)

# Some files appear to be malformed, so we add them to this list after manually verifying that they
# are actually messed up, and it's not just that our pasring is inadequate.
BAD_KEYS = set([
    'ja/jpsubbers/Japanese-Subtitles/@Mains/@2014/@2014_04-06_Spring_Season/マルホの女～保険犯罪調査員～.zip/マルホの女～保険犯罪調査員～＃07.srt',
    'ja/jpsubbers/Japanese-Subtitles/@Mains/@2014/@2014_04-06_Spring_Season/アリスの棘.zip/アリスの棘＃08.srt',
    'ja/jpsubbers/Japanese-Subtitles/@Reairs/@2010-2012/恋を何年休んでますか.zip/恋を何年休んでますか＃01.srt',
])

def process_sub(key, subfn, data, published, verbose, bucket):
    if verbose:
        print(key)

    if key in BAD_KEYS:
        if verbose:
            print('SKIPPING BAD FILE')
        return 0

    (subfn_base, subfn_ext) = os.path.splitext(subfn)
    assert subfn_ext.lower() == '.srt'

    title = subfn_base.replace('_', ' ')

    doc = OrderedDict()
    doc['type'] = 'application/x-subrip'
    doc['lang'] = 'ja'
    doc['title'] = title
    doc['created'] = datetime.utcnow().isoformat() + 'Z'
    if published is not None:
        doc['published'] = published

    # There's probably a proper way to detect encoding, but this works for now.
    # An example of a file with utf-16 is @Mains/@2010/@2010_07-09_Summer_Season/ジョーカー～許されざる捜査官～.zip
    if data[:2] == b'\xff\xfe':
        doc_text = data.decode('utf-16')
    else:
        doc_text = data.decode('utf-8')

    doc_text = doc_text.lstrip('\ufeff')

    if not doc_text:
        if verbose:
            print('SKIPPING EMPTY FILE')
        return 0

    # sanity check that this looks like the start of an SRT file
    assert doc_text.startswith('1\r\n'), repr(doc_text[:16])

    doc['text'] = doc_text

    doc_json = json.dumps(doc, indent=2, ensure_ascii=False)
    if verbose:
        print(doc_json)

    if bucket:
        bucket.put_object(
            Key=key,
            ContentType='application/json',
            Body=doc_json.encode('utf-8')
        )

    return 1

def process_zip(fn, rel_fn, published, verbose, bucket):
    count = 0
    with ZipFile(fn, 'r') as zipf:
        for subfn in sorted(zipf.namelist()):
            key = 'ja/jpsubbers/' + rel_fn + '/' + subfn

            with zipf.open(subfn) as subf:
                data = subf.read()

            count += process_sub(key, subfn, data, published, verbose, bucket)
    return count

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('crawldir')
    parser.add_argument('-v', '--verbose', action='store_true')
    parser.add_argument('-n', '--dry-run', action='store_true', help="don't upload to S3")
    args = parser.parse_args()

    root_dir = args.crawldir
    assert os.path.exists(root_dir), "crawl directory doesn't exist"

    assert os.path.exists(os.path.join(root_dir, 'Japanese-Subtitles')), 'wrong directory?'

    docs_bucket = None
    if not args.dry_run:
        s3 = boto3.resource('s3')
        docs_bucket = s3.Bucket('massif-documents')

    # Mains
    processed_mains = 0
    for fn in glob.iglob(os.path.join(root_dir, 'Japanese-Subtitles/@Mains/@20*/*/*.zip')):
        (season_dir, zip_fn) = os.path.split(fn)
        (year_dir, season_fn) = os.path.split(season_dir)
        (_, year_fn) = os.path.split(year_dir)
        year_str = year_fn[1:]
        year_int = int(year_str)
        assert (year_int >= 2000) and (year_int < 2100)

        rel_fn = os.path.relpath(fn, root_dir)

        processed_mains += process_zip(fn, rel_fn, published=year_str, verbose=args.verbose, bucket=docs_bucket)

    # Reairs
    # recursive because there is some non-uniform directory structure
    processed_reairs = 0
    for fn in glob.iglob(os.path.join(root_dir, 'Japanese-Subtitles/@Reairs/**/*.zip'), recursive=True):
        rel_fn = os.path.relpath(fn, root_dir)

        processed_reairs += process_zip(fn, rel_fn, published=None, verbose=args.verbose, bucket=docs_bucket) # can't determine year it originally aired

    # Specials
    processed_specials = 0
    for fn in glob.iglob(os.path.join(root_dir, 'Japanese-Subtitles/@OtherSPs/@20*/*.srt')):
        rel_fn = os.path.relpath(fn, root_dir)
        key = 'ja/jpsubbers/' + rel_fn

        (_, subfn) = os.path.split(fn)

        date_match = SP_DATE_RE.match(subfn)
        published = '-'.join(date_match.groups())

        with open(fn, 'rb') as f:
            data = f.read()

        processed_specials += process_sub(key, subfn, data, published, verbose=args.verbose, bucket=docs_bucket)

    eprint(f'{processed_mains} mains')
    eprint(f'{processed_reairs} reairs')
    eprint(f'{processed_specials} specials')
    eprint(f'{processed_mains + processed_reairs + processed_specials} total')
