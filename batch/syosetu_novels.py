import re
import time
import json
import os
import sys
from collections import OrderedDict
from datetime import datetime

import requests
from bs4 import BeautifulSoup
import boto3

PUBLISHED_DATE_RE = re.compile(r'^([0-9]{4})/([0-9]{2})/([0-9]{2})')
HEADERS = {'User-Agent': 'MassifBot'}
WAIT_TIME = 5

s3 = boto3.client('s3')
bucket = os.getenv('MASSIF_DOCS_BUCKET')

def process_novel(code, bucket):
    novel_url = f'https://ncode.syosetu.com/{code}/'
    novel_resp = requests.get(novel_url, headers=HEADERS)
    novel_resp.raise_for_status()
    print(novel_url)
    time.sleep(WAIT_TIME)

    LINK_RE = re.compile(r'^/' + re.escape(code) + r'/[1-9][0-9]*/$')

    novel_soup = BeautifulSoup(novel_resp.content, 'html.parser')
    index = novel_soup.find(class_='index_box')
    for chapter in index.find_all('dl', class_='novel_sublist2'):
        chapter_href = chapter.find('dd').find('a').get('href')
        assert LINK_RE.match(chapter_href)

        s3key = 'ja/syosetu' + chapter_href.rstrip('/')

        published_str = chapter.find('dt').contents[0].strip()
        published_match = PUBLISHED_DATE_RE.match(published_str)
        assert published_match
        published = '-'.join(published_match.groups())

        chapter_url = 'https://ncode.syosetu.com' + chapter_href
        chapter_resp = requests.get(chapter_url, headers=HEADERS)
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

        print(chapter_url, '->', s3key)
        time.sleep(WAIT_TIME)

if __name__ == "__main__":
    s3 = boto3.resource('s3')
    docs_bucket = s3.Bucket(os.getenv('MASSIF_DOCS_BUCKET'))

    for line in sys.stdin:
        sline = line.strip()
        if not sline:
            continue
        process_novel(sline, docs_bucket)
