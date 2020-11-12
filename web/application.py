import os

from flask import Flask, request, render_template, redirect, url_for
import requests

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
        xhit = {
            'markup': hit['highlight']['html'][0],
        }
        mdata = meta_map.get(hit['_source']['mid'])
        if mdata:
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
        results_list.append(xhit)
    results['list'] = results_list

    return render_template('index.html', query=query, results=results)

application = app # for EB
