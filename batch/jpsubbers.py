import sys
import os
import glob

if __name__ == '__main__':
    if len(sys.argv) != 2:
        print('ERROR: must specify crawl directory')
        sys.exit(1)

    base_dir = sys.argv[1]
    assert os.path.exists(base_dir), "crawl directory doesn't exist"

    for d in ['jpsubbers.xyz', 'Japanese-Subtitles']:
        ad = os.path.join(base_dir, d)
        if os.path.exists(ad):
            base_dir = ad

    assert os.path.exists(os.path.join(base_dir, '@Mains')), 'appears to be wrong directory'

    for d in glob.iglob(os.path.join(base_dir, '@Mains/@20*/*/*.zip')):
        [season_dir, zip_fn] = os.path.split(d)
        [year_dir, season_fn] = os.path.split(season_dir)
        [_, year_fn] = os.path.split(year_dir)
        print(year_fn, zip_fn)
