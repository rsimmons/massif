import re
from datetime import datetime

from bs4 import BeautifulSoup

from .wayback import Wayback

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

def bs_get_text_only_brs(elem):
    text = ''
    for child in elem.children:
        if isinstance(child, str):
            text += child.strip()
        elif child.name == 'br':
            text += '\n'
        else:
            assert False, 'got unexpected tag in article text'
    return text.replace('\n\n', '\n').strip() # remove these double-newline things

class NHKNews(Wayback):
    def __init__(self):
        super().__init__()

    def get_seed_prefixes(self):
        return [
            'https://digital.asahi.com/articles/',
            'https://www.asahi.com/articles/',
        ]

    def include_url(self, url):
        if '/articles/photo/' in url:
            return False
        return True

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
            for section in soup.select('.content--summary,.content--summary-more,.content--body'):
                # print('SECTION', section, '\n')
                if 'content--body' in section['class']:
                    section_text = ''
                    body_title = section.select_one('.body-title')
                    if body_title:
                        section_text += bs_get_text_only_brs(body_title) + '\n\n'
                    body_text = section.select_one('.body-text')
                    assert body_text
                    section_text += bs_get_text_only_brs(body_text)
                    text_sections.append(section_text)
                else:
                    text = bs_get_text_only_brs(section)
                    if text:
                        text_sections.append(text)
        else:
            news_textbody = soup.select_one('#news_textbody')
            assert news_textbody
            news_textmore = soup.select_one('#news_textmore')
            assert news_textmore

            news_textbody_text = bs_get_text_only_brs(news_textbody)
            assert news_textbody_text
            text_sections.append(news_textbody_text)
            news_textmore_text = bs_get_text_only_brs(news_textmore)
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
