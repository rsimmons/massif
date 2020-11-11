import re
import time
import json
import argparse
import os
import sys
from collections import OrderedDict
from datetime import datetime

import requests
from bs4 import BeautifulSoup
import boto3

PUBLISHED_DATE_RE = re.compile(r'^([0-9]{4})/([0-9]{2})/([0-9]{2})')
HEADERS = {'User-Agent': 'MassifBot/1.0'}
WAIT_TIME = 3

RETRY_TIME = 15
TRY_COUNT = 3

s3 = boto3.client('s3')
bucket = os.getenv('MASSIF_DOCS_BUCKET')

def requests_get_retry(url, headers):
    tries = 0
    while True:
        try:
            return requests.get(url, headers=headers)
        except Exception as exc:
            print('GET ERROR FOR URL', url)
            print(exc)
            tries += 1
            if tries > TRY_COUNT:
                raise
            print('RETRYING')
            time.sleep(RETRY_TIME)

def process_novel(code, bucket, resume_chapter):
    novel_url = f'https://ncode.syosetu.com/{code}/'
    novel_resp = requests_get_retry(novel_url, headers=HEADERS)
    novel_resp.raise_for_status()
    print(datetime.now(), novel_url)
    time.sleep(WAIT_TIME)

    LINK_RE = re.compile(r'^/' + re.escape(code) + r'/([1-9][0-9]*)/$')

    novel_soup = BeautifulSoup(novel_resp.content, 'html.parser')
    index = novel_soup.find(class_='index_box')
    for chapter in index.find_all('dl', class_='novel_sublist2'):
        chapter_href = chapter.find('dd').find('a').get('href')
        link_match = LINK_RE.match(chapter_href)
        assert link_match
        chapter_id = link_match.group(1)

        if resume_chapter:
            if chapter_id == resume_chapter:
                resume_chapter = None
            else:
                continue

        s3key = 'ja/syosetu' + chapter_href.rstrip('/')

        published_str = chapter.find('dt').contents[0].strip()
        published_match = PUBLISHED_DATE_RE.match(published_str)
        assert published_match
        published = '-'.join(published_match.groups())

        chapter_url = 'https://ncode.syosetu.com' + chapter_href
        chapter_resp = requests_get_retry(chapter_url, headers=HEADERS)
        chapter_resp.raise_for_status()

        chapter_soup = BeautifulSoup(chapter_resp.content, 'html.parser')
        title = chapter_soup.title.get_text()
        meat_html = str(chapter_soup.find(id='novel_honbun'))

        doc = OrderedDict()
        doc['type'] = 'text/html'
        doc['lang'] = 'ja'
        doc['url'] = chapter_url
        doc['title'] = title
        doc['created'] = datetime.utcnow().isoformat() + 'Z'
        doc['published'] = published
        doc['text'] = meat_html

        doc_json = json.dumps(doc, indent=2, ensure_ascii=False)

        bucket.put_object(
            Key=s3key,
            ContentType='application/json',
            Body=doc_json.encode('utf-8')
        )

        print(datetime.now(), chapter_url, '->', s3key)
        time.sleep(WAIT_TIME)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument('--resume-code')
    parser.add_argument('--resume-chapter')
    args = parser.parse_args()

    # we will clear this after it is reached
    resume_code = args.resume_code
    resume_chapter = args.resume_chapter

    s3 = boto3.resource('s3')
    docs_bucket = s3.Bucket(os.getenv('MASSIF_DOCS_BUCKET'))

    for line in sys.stdin:
        code = line.strip()
        if not code:
            continue
        if resume_code:
            if code == resume_code:
                resume_code = None
            else:
                continue
        process_novel(code, docs_bucket, resume_chapter)
        resume_chapter = None
