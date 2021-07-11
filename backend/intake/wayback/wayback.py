import argparse
import time

import sqlite3
import requests

CRAWL_PAUSE = 10

'''
CREATE TABLE crawl_url (
  url TEXT NOT NULL UNIQUE,
  timestamp TEXT NOT NULL
);

CREATE TABLE source (
  key TEXT NOT NULL UNIQUE,
  url TEXT,
  title TEXT,
  pubdate TEXT,
  ctype TEXT,
  content TEXT
);
'''

cxn = None

def db_open(dbfn):
    global cxn
    cxn = sqlite3.connect(dbfn)

def db_close():
    global cxn
    if cxn:
        cxn.close()
    cxn = None

def insert_crawl_urls(crawl_urls):
    cur = cxn.cursor()

    cur.execute('BEGIN')

    for (timestamp, url) in crawl_urls:
        cur.execute('INSERT INTO crawl_url (url, timestamp) VALUES (?, ?) ON CONFLICT (url) DO UPDATE SET url=excluded.url, timestamp=excluded.timestamp', (url, timestamp))

    cur.execute('COMMIT')

class Wayback:
    def __init__(self):
        pass

    def crawl_seeds(self):
        for seed_prefix in self.get_seed_prefixes():
            print(f'Crawling seed prefix {seed_prefix!r}')
            params = {
                'url': seed_prefix,
                'matchType': 'prefix',
                'output': 'json',
                'fl': 'urlkey,timestamp,original',
                'filter': ['statuscode:200', 'mimetype:text/html'],
                'limit': '100000',
            }
            r = requests.get('https://web.archive.org/web/timemap/', params=params)
            r.raise_for_status()

            result_rows = r.json()
            print(f'Got {len(result_rows)} result rows')

            urlkey_last = {}
            for (urlkey, timestamp, original) in result_rows:
                urlkey_last[urlkey] = (timestamp, original)

            good_urls = []
            for (urkley, (timestamp, original)) in urlkey_last.items():
                if self.include_url(original):
                    good_urls.append((timestamp, original))

            print(f'Filtered to {len(good_urls)} urls')
            insert_crawl_urls(good_urls)

            time.sleep(CRAWL_PAUSE)

    def run_main(self):
        parser = argparse.ArgumentParser()
        parser.add_argument('sqlite_db')
        args = parser.parse_args()

        db_open(args.sqlite_db)

        self.crawl_seeds()

        db_close()
