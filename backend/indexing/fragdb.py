import sqlite3

'''
CREATE TABLE fragment (
  id INTEGER PRIMARY KEY,
  text TEXT NOT NULL UNIQUE,
  logprob REAL,
  count_chars INTEGER,
  count_mchars INTEGER,
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

CREATE TABLE location (
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

def iter_fragments(tname):
    cur = cxn.cursor()
    return cur.execute(f'SELECT * FROM {tname}')

def insert_source_fragments(source, located_fragments):
    cur = cxn.cursor()

    cur.execute('BEGIN TRANSACTION')

    cur.execute('INSERT INTO source (s3key, title, pubdate, url, tags) VALUES (?, ?, ?, ?, ?) ON CONFLICT (s3key) DO UPDATE SET title=excluded.title, pubdate=excluded.pubdate, url=excluded.url', (source['s3key'], source['title'], source['pubdate'], source['url'], source['tags']))

    cur.execute('SELECT id FROM source WHERE s3key = ?', (source['s3key'], ))
    source_id = cur.fetchone()[0]

    for located_fragment in located_fragments:
        cur.execute('INSERT INTO fragment (text) VALUES (?) ON CONFLICT (text) DO NOTHING', (located_fragment['text'], ))
        # https://www.mail-archive.com/sqlite-users@mailinglists.sqlite.org/msg118667.html
        # I am a little skeptical that the performance won't be bad, but let's see.
        cur.execute('INSERT INTO location (fragment_id, source_id, loc) VALUES ((SELECT id FROM fragment WHERE text = ?), ?, ?) ON CONFLICT DO NOTHING', (located_fragment['text'], source_id, located_fragment['loc']))

    cur.execute('COMMIT')
