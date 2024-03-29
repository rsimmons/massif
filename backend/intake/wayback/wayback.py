import sys
import argparse
import time
import json
import urllib

import sqlite3
import requests

LONG_CRAWL_PAUSE = 10
CRAWL_PAUSE = 2

CRAWL_RETRIES = 6
RETRY_PAUSE = 300

MASSIFBOT_UA = 'Massifbot (+http://www.massif.com/)'

'''
CREATE TABLE crawl_url (
  url TEXT PRIMARY KEY NOT NULL,
  timestamp TEXT NOT NULL
);

CREATE TABLE crawl_result (
  url TEXT PRIMARY KEY NOT NULL,
  timestamp TEXT NOT NULL,
  data TEXT NOT NULL
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

def iter_uncrawled_urls():
    cur = cxn.cursor()
    for row in cur.execute('SELECT url, timestamp FROM crawl_url WHERE NOT EXISTS (SELECT url FROM crawl_result WHERE crawl_result.url = crawl_url.url)'):
        yield {
            'url': row[0],
            'timestamp': row[1],
        }

def insert_crawl_result(url, timestamp, data):
    cur = cxn.cursor()
    cur.execute('BEGIN')
    cur.execute('INSERT INTO crawl_result (url, timestamp, data) VALUES (?, ?, ?)', (url, timestamp, data))
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
            r = requests.get('https://web.archive.org/web/timemap/', params=params, headers={'User-Agent': MASSIFBOT_UA})
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

            time.sleep(LONG_CRAWL_PAUSE)

    def crawl_seeds_cdx(self):
        for seed_prefix in self.get_seed_prefixes():
            # Repeat batches, resuming each time
            print(f'Crawling seed prefix (via CDX API) {seed_prefix!r}')
            resume_key = None
            while True:
                params = {
                    'url': seed_prefix,
                    'matchType': 'prefix',
                    'output': 'json',
                    'fl': 'urlkey,timestamp,original',
                    'filter': ['statuscode:200', 'mimetype:text/html'],
                    'limit': '10000',
                    'showResumeKey': 'true',
                }
                if resume_key is not None:
                    params['resumeKey'] = resume_key

                r = requests.get('https://web.archive.org/cdx/search/cdx', params=params, headers={'User-Agent': MASSIFBOT_UA})
                r.raise_for_status()

                raw_result_rows = r.json()
                if (len(raw_result_rows) > 0) and (raw_result_rows[0][0] == 'urlkey'):
                    # header row
                    raw_result_rows = raw_result_rows[1:]
                if (len(raw_result_rows) >= 2) and (len(raw_result_rows[-2]) == 0):
                    # there is a resume key
                    resume_key = urllib.parse.unquote(raw_result_rows[-1][0])
                    result_rows = raw_result_rows[:-2]
                else:
                    resume_key = None
                    result_rows = raw_result_rows

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

                if resume_key is None:
                    break

                time.sleep(LONG_CRAWL_PAUSE)

    def parse_file(self, fn, url):
        return self.parse_string(open(fn).read(), url)

    def crawl(self):
        for info in iter_uncrawled_urls():
            for retry in range(CRAWL_RETRIES):
                try:
                    r = requests.get(f'https://web.archive.org/web/{info["timestamp"]}/{info["url"]}', headers={'User-Agent': MASSIFBOT_UA})
                    r.raise_for_status()
                    break
                except:
                    print('REQUEST ERROR', sys.exc_info()[0])
                    time.sleep(RETRY_PAUSE)

            # print(r.text)

            try:
                parse_result = self.parse_string(r.text, info['url'])
            except:
                print('ERROR parsing url', info['url'])
                print('TEXT:')
                print(r.text)
                raise
            json_text = json.dumps(parse_result, ensure_ascii=False, indent=2)
            # print(json_text)

            insert_crawl_result(info['url'], info['timestamp'], json_text)

            print('CRAWLED', info['timestamp'], info['url'])

            time.sleep(CRAWL_PAUSE)

    def run_main(self):
        parser = argparse.ArgumentParser()
        parser.add_argument('--sqlite-db')
        parser.add_argument('--parse-url')
        parser.add_argument('--parse-fn')
        parser.add_argument('command')
        args = parser.parse_args()

        if args.command == 'crawl_seeds':
            assert args.sqlite_db
            db_open(args.sqlite_db)
            self.crawl_seeds_cdx()
        elif args.command == 'parse_file':
            assert args.parse_fn
            assert args.parse_url
            print(json.dumps(self.parse_file(args.parse_fn, args.parse_url), ensure_ascii=False, indent=2))
        elif args.command == 'crawl':
            assert args.sqlite_db
            db_open(args.sqlite_db)
            self.crawl()
        else:
            assert False, 'unrecognized command'
