import os

from flask import Flask, request, render_template, redirect, url_for
import requests
from bs4 import BeautifulSoup

app = Flask(__name__)

ES_HOST = os.getenv('ES_HOST', 'localhost')
ES_BASE_URL = f'http://{ES_HOST}:9200'

RESULTS_PER_PAGE = 25

CHUNK_INDEX = 'chunk_ja'
META_INDEX = 'meta_ja'

@app.before_request
def before_request():
    if not request.is_secure and app.env == 'production':
        url = request.url.replace('http://', 'https://', 1)
        return redirect(url, code=301)

@app.route('/')
def index():
    return redirect(url_for('ja'))

@app.route('/ja')
def ja():
    return render_template('index.html')

# this is rather complicated, but I didn't immediately see how to get this from libraries
def format_time(t):
    result = ''
    rt = t
    if rt >= 60*60:
        result += str(int(rt/(60*60))) + ':'
        rt = rt % (60*60)
    if rt >= 60 or result:
        mins = int(rt/60)
        result += f'{mins:02d}:' if result else f'{mins:d}:'
        rt = rt % 60
    secs = int(rt)
    result += f'{secs:02d}' if result else str(secs)
    return result

@app.route('/ja/search')
def ja_search():
    query = request.args.get('q', '')
    phrases = query.split()
    print('query phrases are', phrases)

    results = {}

    main_resp = requests.get(f'{ES_BASE_URL}/{CHUNK_INDEX}/_search', json={
        'query': {
            'bool': {
                'must': [{'match_phrase': {'html': phrase}} for phrase in phrases]
            }
        },
        'highlight': {
            'type': 'unified',
            'fields': {
                'html': {
                    'number_of_fragments': 0, # forces it to return entire field
                },
            },
        },
        'size': RESULTS_PER_PAGE,
    })
    main_resp.raise_for_status()

    main_resp_body = main_resp.json()

    hitcount_value = main_resp_body['hits']['total']['value']
    if main_resp_body['hits']['total']['relation'] == 'eq':
        hitcount_qual = ''
    elif main_resp_body['hits']['total']['relation'] == 'gte':
        hitcount_qual = '>'
    else:
        assert False
    hitcount_str = hitcount_qual + str(hitcount_value)
    if hitcount_value > RESULTS_PER_PAGE:
        results['count_str'] = f'showing {RESULTS_PER_PAGE} of {hitcount_str} results'
    else:
        results['count_str'] = f'showing {hitcount_str} results'

    meta_idx_ids = []
    for hit in main_resp_body['hits']['hits']:
        cidx = hit['_index']
        assert cidx.startswith('chunk_')
        midx = 'meta_' + cidx[len('chunk_'):]
        meta_idx_ids.append((midx, hit['_source']['mid']))

    if meta_idx_ids:
        meta_resp = requests.get(f'{ES_BASE_URL}/_mget', json={'docs': [{'_index': idx, '_id': did} for (idx, did) in meta_idx_ids]})
        meta_resp.raise_for_status()
        meta_resp_body = meta_resp.json()
        meta_map = {doc['_id']: doc['_source'] for doc in meta_resp_body['docs']}
    else:
        meta_map = {}

    results_list = []
    for hit in main_resp_body['hits']['hits']:
        xhit = {}

        mdata = meta_map.get(hit['_source']['mid'], {})

        xhit['title'] = mdata['title']
        if 'published' in mdata:
            xhit['published'] = mdata['published']

        if 'url' in mdata:
            xhit['url'] = mdata['url']

        chunk_tags = hit['_source'].get('tags', [])
        xhit['tags'] = []
        for t, trans in [('novel', '小説'), ('drama', 'ドラマ')]:
            if t in chunk_tags:
                xhit['tags'].append(trans)

        hit_html = hit['highlight']['html'][0]
        soup = BeautifulSoup(hit_html, 'html.parser')

        min_time = None
        max_time = None
        for p in soup.find_all('p'):
            if p.get('a') and mdata.get('url'):
                p_url = mdata['url'] + '#' + p['a']
                del p['a']

                link_icon_tag = soup.new_tag('img')
                link_icon_tag['class'] = 'link-icon'
                link_icon_tag['src'] = url_for('static', filename='link.svg')
                p.append(link_icon_tag)

                a_tag = soup.new_tag('a', href=p_url)
                a_tag['class'] = 'source-anchor-link'
                p.wrap(a_tag)

            for attr in ['t0', 't1']:
                if p.get(attr):
                    min_time = min(float(p[attr]), min_time if (min_time is not None) else float('inf'))
                    max_time = max(float(p[attr]), min_time if (min_time is not None) else 0)
                    del p[attr]
        xhit['markup'] = str(soup)

        if (min_time is not None) and (max_time is not None):
            time_range_str = format_time(min_time) + '-' + format_time(max_time)
            xhit['time_range'] = time_range_str

        results_list.append(xhit)

    results['list'] = results_list

    return render_template('index.html', query=query, results=results)

application = app # for EB
