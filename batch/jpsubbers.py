import sys
import os
import glob
import json
from datetime import datetime
from zipfile import ZipFile
from collections import OrderedDict

def eprint(*args, **kwargs):
    print(*args, file=sys.stderr, **kwargs)

BAD_KEYS = set([
    'ja/jpsubbers/Japanese-Subtitles/@Mains/@2014/@2014_04-06_Spring_Season/マルホの女～保険犯罪調査員～.zip/マルホの女～保険犯罪調査員～＃07.srt',
    'ja/jpsubbers/Japanese-Subtitles/@Mains/@2014/@2014_04-06_Spring_Season/アリスの棘.zip/アリスの棘＃08.srt',
    'ja/jpsubbers/Japanese-Subtitles/@Reairs/@2010-2012/恋を何年休んでますか.zip/恋を何年休んでますか＃01.srt',
])

def process_zip(fn, rel_fn, published):
    with ZipFile(fn, 'r') as zipf:
        for subfn in sorted(zipf.namelist()):
            [subfn_base, subfn_ext] = os.path.splitext(subfn)
            assert subfn_ext.lower() == '.srt'

            key = 'ja/jpsubbers/' + rel_fn + '/' + subfn
            print(key)

            if key in BAD_KEYS:
                print('SKIPPING BAD DOCUMENT')
                continue

            title = subfn_base.replace('_', ' ')

            doc = OrderedDict()
            doc['type'] = 'application/x-subrip'
            doc['lang'] = 'ja'
            doc['title'] = title
            doc['created'] = datetime.utcnow().isoformat() + 'Z'
            if published is not None:
                doc['published'] = published

            with zipf.open(subfn) as subf:
                data = subf.read()
                # there's probably a proper way to detect this, but it works for now
                # one file with utf-16 is @Mains/@2010/@2010_07-09_Summer_Season/ジョーカー～許されざる捜査官～.zip
                if data[:2] == b'\xff\xfe':
                    doc['text'] = data.decode('utf-16')
                else:
                    try:
                        doc['text'] = data.decode('utf-8')
                    except:
                        print(repr(data[:64]))
                        raise

            print(json.dumps(doc, indent=2, ensure_ascii=False))

if __name__ == '__main__':
    if len(sys.argv) != 2:
        print('ERROR: must specify crawl directory')
        sys.exit(1)

    root_dir = sys.argv[1]
    assert os.path.exists(root_dir), "crawl directory doesn't exist"

    assert os.path.exists(os.path.join(root_dir, 'Japanese-Subtitles')), 'wrong directory?'

    # recursive because there is some non-uniform directory structure
    for fn in glob.iglob(os.path.join(root_dir, 'Japanese-Subtitles/@Reairs/**/*.zip'), recursive=True):
        rel_fn = os.path.relpath(fn, root_dir)

        process_zip(fn, rel_fn, published=None) # can't determine year it originally aired

    for fn in glob.iglob(os.path.join(root_dir, 'Japanese-Subtitles/@Mains/@20*/*/*.zip')):
        [season_dir, zip_fn] = os.path.split(fn)
        [year_dir, season_fn] = os.path.split(season_dir)
        [_, year_fn] = os.path.split(year_dir)
        year_str = year_fn[1:]
        year_int = int(year_str)
        assert (year_int >= 2000) and (year_int < 2100)

        rel_fn = os.path.relpath(fn, root_dir)

        process_zip(fn, rel_fn, published=year_str)
