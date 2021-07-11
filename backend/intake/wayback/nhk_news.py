import re

from .wayback import Wayback

INCLUDE_URL_RE = re.compile(r'/news/html/[0-9]+/[kt][0-9]+\.html$') # other ones seem worthless. recent years only use k, old ones sometimes use t it seems

class NHKNews(Wayback):
    def __init__(self):
        super().__init__()

    def get_seed_prefixes(self):
        result = []
        for year in range(2012, 2021):
            for month in range(1, 13):
                date_str = f'{year}{month:02d}'
                result.append(f'https://www3.nhk.or.jp/news/html/{date_str}')
        return result

    def include_url(self, url):
        return bool(INCLUDE_URL_RE.search(url))

if __name__ == '__main__':
    wb = NHKNews()
    wb.run_main()
