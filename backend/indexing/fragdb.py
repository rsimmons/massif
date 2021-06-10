import sqlite3

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
