import re
import time

import requests
from bs4 import BeautifulSoup

NOVEL_LINK_RE = re.compile(r'https://ncode\.syosetu\.com/([^/]+)/')

def parse_search_result_page(html):
    soup = BeautifulSoup(html, 'html.parser')

    results = soup.find_all(class_='searchkekka_box')
    assert len(results) == 20

    for result in results:
        novel_link = result.find('a', class_='tl')
        novel_href = novel_link.get('href')
        novel_match = NOVEL_LINK_RE.match(novel_href)
        assert novel_match
        code = novel_match.group(1)
        print(code)

if __name__ == "__main__":
    # with open('syosetsu.html') as f:
    #     html = f.read()
    #     parse_search_result_page(html)

    order = 'hyoka'
    for page in range(1, 101):
        url = f'https://yomou.syosetu.com/search.php?&order_former=search&order={order}&notnizi=1&p={page}'
        resp = requests.get(url, headers={'User-Agent': 'MassifBot'})
        resp.raise_for_status()
        parse_search_result_page(resp.content)

        time.sleep(5)
