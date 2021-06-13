import os
import time
import random

from flask import Flask, request, render_template, redirect, url_for
import requests
from bs4 import BeautifulSoup

app = Flask(__name__)

ES_HOST = os.getenv('ES_HOST', 'localhost')
ES_BASE_URL = f'http://{ES_HOST}:9200'

RESULTS_PER_PAGE = 25
FRAGMENT_RESULTS_PER_PAGE = 100

FRAGMENT_INDEX = 'fragment_ja'
SOURCE_INDEX = 'source_ja'

@app.before_request
def before_request():
    if not request.is_secure and app.env == 'production':
        url = request.url.replace('http://', 'https://', 1)
        return redirect(url, code=301)

@app.route('/')
def index():
    return redirect(url_for('ja'))

@app.route('/about')
def about():
    return render_template('about.html')

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
def ja_fsearch():
    query = request.args.get('q', '')

    # PARSE QUERY
    phrases = query.split()
    print('query phrases are', phrases)

    results = {}

    # SEARCH FRAGMENTS
    t0 = time.time()
    main_resp = requests.get(f'{ES_BASE_URL}/{FRAGMENT_INDEX}/_search', json={
        'query': {
            'bool': {
                'must': [{'match_phrase': {'text': phrase}} for phrase in phrases]
            }
        },
        'sort': [
            {'mscore': 'desc'},
        ],
        # 'track_total_hits': False, # required for early termination
        'highlight': {
            'type': 'unified',
            'fields': {
                'text': {
                    'number_of_fragments': 0, # forces it to return entire field
                },
            },
        },
        'size': FRAGMENT_RESULTS_PER_PAGE,
    })
    dt = time.time() - t0
    main_resp.raise_for_status()
    print(f'took {dt}s')

    # FORMAT RESULT COUNT
    main_resp_body = main_resp.json()
    hitcount_value = main_resp_body['hits']['total']['value']

    hitcount_value = main_resp_body['hits']['total']['value']
    if main_resp_body['hits']['total']['relation'] == 'eq':
        hitcount_qual = ''
    elif main_resp_body['hits']['total']['relation'] == 'gte':
        hitcount_qual = '>'
    else:
        assert False
    hitcount_str = hitcount_qual + str(hitcount_value)
    if hitcount_value > FRAGMENT_RESULTS_PER_PAGE:
        results['count_str'] = f'first {FRAGMENT_RESULTS_PER_PAGE} of {hitcount_str} unique matching sentences'
    else:
        results['count_str'] = f'{hitcount_str}  unique matching sentences'

    # FIGURE OUT SOURCE IDS TO FETCH
    source_infos = [] # list of {total_hits, source_id, loc}
    for hit in main_resp_body['hits']['hits']:
        total_count = 0
        combined_sample_hits = []
        for (tag_set_str, tag_set_info) in hit['_source']['hits'].items():
            total_count += tag_set_info['count']
            combined_sample_hits.extend(tag_set_info['sample'])
        chosen_hit = random.choice(combined_sample_hits)

        source_infos.append({
            'total_hits': total_count,
            'source_id': chosen_hit['source_id'],
            'loc': chosen_hit['loc'],
        })

    # FETCH SOURCE RECORDS
    if source_infos:
        unique_source_ids = set(s['source_id'] for s in source_infos)
        source_resp = requests.get(f'{ES_BASE_URL}/_mget', json={'docs': [{'_index': SOURCE_INDEX, '_id': sid} for sid in unique_source_ids]})
        source_resp.raise_for_status()
        source_resp_body = source_resp.json()
        source_map = {doc['_id']: doc['_source'] for doc in source_resp_body['docs']}
    else:
        # empty query doesn't work IIRC
        source_map = {}

    # PREPARE RESULT LIST FOR TEMPLATE
    results_list = []
    assert len(main_resp_body['hits']['hits']) == len(source_infos) # sanity check
    for (hit, source_info) in zip(main_resp_body['hits']['hits'], source_infos):
        xhit = {}

        hit_html = hit['highlight']['text'][0]
        xhit['markup'] = str(hit_html)

        source_record = source_map[str(source_info['source_id'])]
        xhit['title'] = source_record['title']
        if 'published' in source_record:
            xhit['published'] = source_record['published']
        if 'url' in source_record:
            xhit['url'] = source_record['url']
        xhit['other_count'] = source_info['total_hits'] - 1
        # Uncomment this to add back in tags display
        # source_tags = source_record['tags']
        # xhit['tags'] = []
        # for t, trans in [('novel', '小説'), ('drama', 'ドラマ')]:
        #     if t in source_tags:
        #         xhit['tags'].append(trans)

        results_list.append(xhit)

    results['list'] = results_list

    return render_template('index.html', query=query, results=results)

application = app # for EB
