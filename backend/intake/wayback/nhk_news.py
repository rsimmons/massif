import re
from datetime import datetime

from bs4 import BeautifulSoup

from .wayback import Wayback

INCLUDE_URL_RE = re.compile(r'/news/html/[0-9]+/[kt][0-9]+\.html$') # other ones seem worthless. recent years only use k, old ones sometimes use t it seems

NEWS_DATE_RE = re.compile(r'^([0-9]+)月([0-9]+)日$')
NEWS_TIME_RE = re.compile(r'^([0-9]+)時([0-9]+)分$')
URL_YEAR_RE = re.compile(r'/news/html/(20[0-9]{2})')

REMOVE_KEYWORDS = {
    'ＮＨＫ',
    'ニュース',
    'ＮＨＫニュース',
    'NHK NEWS WEB',
    'NHK',
    'ニュース',
    'NHK NEWS WEB',
}

def bs_get_text_restricted(elem):
    text = ''
    for child in elem.children:
        if isinstance(child, str):
            text += child.strip()
        elif child.name == 'br':
            text += '\n'
        elif child.name in ['h1', 'h2', 'h3', 'h4']:
            text += bs_get_text_restricted(child) + '\n\n\n\n' # HACK, these newlines will get turned into just two newlines (what we want) below
        elif (child.name == 'span') and (len(child['class']) == 1) and (child['class'][0] in ('pattern_1', 'pattern_3', 'pattern_4')):
            # first encountered pattern_1 in http://www3.nhk.or.jp:80/news/html/20170410/k10010943021000.html
            # first encountered pattern_3 in http://www3.nhk.or.jp:80/news/html/20170829/k10011117671000.html
            # first encountered pattern_4 in http://www3.nhk.or.jp:80/news/html/20190422/k10011892041000.html
            text += bs_get_text_restricted(child)
        else:
            assert False, 'got unexpected tag in article text: ' + str(child)
    result = text.replace('\n\n', '\n').strip() # remove these double-newline things, lots of <br /><br /> in pages where we only want one break
    return result

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

    def parse_string(self, text, url):
        soup = BeautifulSoup(text, 'html.parser')

        page_title = soup.title.text
        assert page_title.strip()

        meta_keywords = soup.select_one('meta[name=keywords]')
        assert meta_keywords
        keywords_str = meta_keywords['content']
        keywords_list = [kw for kw in keywords_str.split(',') if kw and kw not in REMOVE_KEYWORDS]
        # keywords = ','.join(keywords_list).strip()

        news_title = soup.select_one('.news_title')
        if news_title:
            headline = news_title.text.strip()
        else:
            contentTitle = soup.select_one('.contentTitle')
            if contentTitle:
                headline = contentTitle.text.strip()
            else:
                content__title = soup.select_one('.content--title')
                if content__title:
                    headline = content__title.text.strip()
                else:
                    assert False

        time_elem = soup.select_one('time')
        if time_elem:
            dt = time_elem['datetime']
        else:
            news_date = soup.select_one('#news_date')
            news_time = soup.select_one('#news_time')
            assert news_date and news_time
            month_str, day_str = NEWS_DATE_RE.match(news_date.text).groups()
            month = int(month_str)
            day = int(day_str)
            hour_str, minute_str = NEWS_TIME_RE.match(news_time.text).groups()
            hour = int(hour_str)
            minute = int(minute_str)
            year_str = URL_YEAR_RE.search(url).groups()[0]
            dt = f'{year_str}-{month:02d}-{day:02d}T{hour:02d}:{minute:02d}'
            datetime.fromisoformat(dt) # parse to make sure it doesn't throw, ignore return

        text_sections = []
        content__detail_main = soup.select_one('.content--detail-main') # newer pages
        if content__detail_main:
            # newer pages
            for section in soup.select('.content--summary,.content--summary-more,.content--body'):
                # print('SECTION', section, '\n')
                if 'content--body' in section['class']:
                    section_text = ''
                    body_title = section.select_one('.body-title')
                    if body_title:
                        section_text += bs_get_text_restricted(body_title) + '\n\n'
                    body_text = section.select_one('.body-text')
                    assert body_text
                    section_text += bs_get_text_restricted(body_text)
                    text_sections.append(section_text)
                else:
                    text = bs_get_text_restricted(section)
                    if text:
                        text_sections.append(text)
        else:
            # older pages
            news_textbody = soup.select_one('#news_textbody')
            assert news_textbody
            news_textmore = soup.select_one('#news_textmore')
            assert news_textmore

            news_textbody_text = bs_get_text_restricted(news_textbody)
            assert news_textbody_text
            text_sections.append(news_textbody_text)
            news_textmore_text = bs_get_text_restricted(news_textmore)
            if news_textmore_text:
                text_sections.append(news_textmore_text)

        return {
            'url': url,
            'title': page_title,
            'keywords': keywords_list,
            'headline': headline,
            'datetime': dt,
            'sections': text_sections,
        }

if __name__ == '__main__':
    wb = NHKNews()
    wb.run_main()
