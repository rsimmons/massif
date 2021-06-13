import json

import sqlite3

'''
CREATE TABLE fragment (
  id INTEGER PRIMARY KEY,
  text TEXT NOT NULL UNIQUE,
  count_chars INTEGER NOT NULL,
  count_mchars INTEGER NOT NULL,
  logprob REAL,
  count_toks INTEGER
);

CREATE TABLE source (
  id INTEGER PRIMARY KEY,
  s3key TEXT NOT NULL UNIQUE,
  title TEXT,
  pubdate TEXT,
  url TEXT,
  tags TEXT
);

CREATE TABLE hit (
  fragment_id INTEGER NOT NULL,
  source_id INTEGER NOT NULL,
  loc TEXT NOT NULL,
  UNIQUE(fragment_id, source_id, loc)
);
'''

cxn = None

def open(dbfn):
    global cxn
    cxn = sqlite3.connect(dbfn)

def close():
    global cxn
    if cxn:
        cxn.close()
    cxn = None

def iter_fragments_plus():
    cur = cxn.cursor()
    for row in cur.execute('''SELECT f.text, f.logprob, f.count_chars, f.count_mchars, json_group_array(json_object('source_id', h.source_id, 'loc', h.loc, 'tags', s.tags)) FROM fragment f INNER JOIN hit h ON f.id = h.fragment_id, source s ON s.id = h.source_id WHERE f.logprob IS NOT NULL GROUP BY f.text'''):
        yield {
            'text': row[0],
            'logprob': row[1],
            'count_chars': row[2],
            'count_mchars': row[3],
            'hits': json.loads(row[4]), # has fields source_id, loc, tags
        }

def iter_sources():
    cur = cxn.cursor()
    for row in cur.execute('SELECT id, s3key, title, pubdate, url, tags FROM source'):
        yield {
            'id': row[0],
            's3key': row[1],
            'title': row[2],
            'pubdate': row[3],
            'url': row[4],
            'tags': row[5],
        }

def insert_source_fragments(source, located_fragments):
    cur = cxn.cursor()

    cur.execute('BEGIN')

    cur.execute('INSERT INTO source (s3key, title, pubdate, url, tags) VALUES (?, ?, ?, ?, ?) ON CONFLICT (s3key) DO UPDATE SET title=excluded.title, pubdate=excluded.pubdate, url=excluded.url', (source['s3key'], source['title'], source['pubdate'], source['url'], source['tags']))

    cur.execute('SELECT id FROM source WHERE s3key = ?', (source['s3key'], ))
    source_id = cur.fetchone()[0]

    for located_fragment in located_fragments:
        cur.execute('INSERT INTO fragment (text, count_chars, count_mchars) VALUES (?, ?, ?) ON CONFLICT (text) DO NOTHING', (located_fragment['text'], located_fragment['count_chars'], located_fragment['count_mchars']))
        # https://www.mail-archive.com/sqlite-users@mailinglists.sqlite.org/msg118667.html
        # I am a little skeptical that the performance won't be bad, but let's see.
        cur.execute('INSERT INTO hit (fragment_id, source_id, loc) VALUES ((SELECT id FROM fragment WHERE text = ?), ?, ?) ON CONFLICT DO NOTHING', (located_fragment['text'], source_id, located_fragment['loc']))

    cur.execute('COMMIT')
