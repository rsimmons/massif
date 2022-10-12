import os
import time
import random
import json

from flask import Flask, request, render_template, redirect, url_for, escape, send_from_directory, abort, jsonify
from flask_cors import CORS
import requests

from common.ja import ja_get_text_morphemes, ja_get_morphemes_normal_stats, ja_get_text_tokenization

app = Flask(__name__)

# This avoids errors in dev
if app.env == 'development':
    CORS(app)

# Elastic Beanstalk requires "application" to be set
application = app

# Not necessary to keep ASCII, and impedes debugging Japanese
app.config['JSON_AS_ASCII'] = False

# It's nice to have this pretty printed even if it takes a few more bytes to transfer
app.config['JSONIFY_PRETTYPRINT_REGULAR'] = True

ES_HOST = os.getenv('ES_HOST', 'localhost')
ES_BASE_URL = f'http://{ES_HOST}:9200'

DEEPL_API_KEY = os.getenv('DEEPL_API_KEY')

RESULTS_PER_PAGE = 25
DEFAULT_FRAGMENT_RESULTS_PER_PAGE = 100
MAX_FRAGMENT_RESULTS_PER_PAGE = 10000

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
    response_format = request.args.get('fmt', 'html')
    include_tokens = request.args.get('toks') is not None
    max_results = min(int(request.args.get('maxres', DEFAULT_FRAGMENT_RESULTS_PER_PAGE)), MAX_FRAGMENT_RESULTS_PER_PAGE)

    print('query', json.dumps({'query': query, 'format': response_format, 'tokens': include_tokens, 'max_results': max_results}, sort_keys=True, ensure_ascii=True), flush=True)

    # PARSE QUERY
    phrases = query.split()
    if not phrases:
        return redirect(url_for('ja'))


    # SEARCH FRAGMENTS
    results = {}
    json_response = {}

    subqueries = []
    exact_phrases = []
    for phrase in phrases:
        if phrase.startswith('"') and phrase.endswith('"') and (len(phrase) >= 3):
            exact_phrase = phrase[1:-1]
            if ('*' in exact_phrase) or ('?' in exact_phrase):
                # if someone uses these, just skip it, because they have special meaning
                continue
            subqueries.append({'wildcard': {'text.wc': {'value': '*' + exact_phrase + '*'}}})
            exact_phrases.append(exact_phrase)
        else:
            subqueries.append({'match_phrase': {'text': phrase}})

    t0 = time.time()
    main_resp = requests.get(f'{ES_BASE_URL}/{FRAGMENT_INDEX}/_search', json={
        'query': {
            'bool': {
                'must': subqueries,
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
                    # I think we could use the following if we indexed with with_positions_offsets and then did fvh highlight?
                    #'matched_fields': ['text', 'text.wc'],
                },
            },
        },
        'size': max_results,
    })
    dt = time.time() - t0
    main_resp.raise_for_status()
    print('es_request_time', f'{dt}', flush=True)

    # FORMAT RESULT COUNT
    main_resp_body = main_resp.json()
    hitcount_value = main_resp_body['hits']['total']['value']

    json_response['hits'] = hitcount_value

    if main_resp_body['hits']['total']['relation'] == 'eq':
        hitcount_qual = ''
        json_response['hits_limited'] = False
    elif main_resp_body['hits']['total']['relation'] == 'gte':
        hitcount_qual = '>'
        json_response['hits_limited'] = True
    else:
        assert False
    hitcount_str = hitcount_qual + str(hitcount_value)
    if hitcount_value > max_results:
        results['count_str'] = f'first {max_results} of {hitcount_str} unique matching sentences'
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
    json_results_list = []
    assert len(main_resp_body['hits']['hits']) == len(source_infos) # sanity check
    for (hit, source_info) in zip(main_resp_body['hits']['hits'], source_infos):
        xhit = {}
        json_xhit = {}

        # If we only have exact phrase matches, then there won't be a highlighted version, so we just
        # escape the raw text and use that.
        hit_html = hit['highlight']['text'][0] if ('highlight' in hit) else str(escape(hit['_source']['text']))
        # HACKY: manually highlight exact matches.
        # Can result in nesting, but that's not a problem. Won't handle not-nesting overlaps.
        for exact_phrase in exact_phrases:
            hit_html = hit_html.replace(exact_phrase, '<em>' + exact_phrase + '</em>')
        xhit['markup'] = str(hit_html)

        json_xhit['text'] = hit['_source']['text']
        json_xhit['highlighted_html'] = str(hit_html)

        source_record = source_map[str(source_info['source_id'])]
        json_xhit['sample_source'] = {}

        xhit['title'] = source_record['title']
        json_xhit['sample_source']['title'] = source_record['title']
        if 'published' in source_record:
            xhit['published'] = source_record['published']
            json_xhit['sample_source']['publish_date'] = source_record['published']
        if 'url' in source_record:
            xhit['url'] = source_record['url']
            json_xhit['sample_source']['url'] = source_record['url']
        xhit['other_count'] = source_info['total_hits'] - 1

        json_xhit['source_count'] = source_info['total_hits']

        if include_tokens:
            json_xhit['tokens'] = ja_get_text_tokenization(json_xhit['text'])

        # Uncomment this to add back in tags display
        # source_tags = source_record['tags']
        # xhit['tags'] = []
        # for t, trans in [('novel', '小説'), ('drama', 'ドラマ')]:
        #     if t in source_tags:
        #         xhit['tags'].append(trans)

        results_list.append(xhit)
        json_results_list.append(json_xhit)

    results['list'] = results_list
    json_response['results'] = json_results_list

    if response_format == 'html':
        return render_template('index.html', query=query, results=results)
    elif response_format == 'json':
        response = jsonify(json_response)
        response.headers.add('Access-Control-Allow-Origin', '*')
        return response
    else:
        assert False

#
# PATHFINDER
#
PATHFINDER_BUILD_DIR = 'pathfinder/build'

@app.route('/ja/pathfinder')
def ja_pathfinder_root():
    # NOTE: Instead of doing this:
    # send_from_directory(PATHFINDER_BUILD_DIR, 'index.html')
    # we render this template, which is actually a symlink to pathfinder/build/index.html,
    # so that we don't have to deal with having two template directories.
    # This could be an issue if there was accidentally anything that looked like a template
    # substitution in the frontend code, but it works for now.
    return render_template('pathfinder_index.html')

@app.route("/ja/pathfinder/<path:name>")
def ja_pathfinder_sub(name):
    return send_from_directory(PATHFINDER_BUILD_DIR, name)

#
# TANKEN
#
TANKEN_BUILD_DIR = 'tanken/build'

@app.route('/ja/tanken')
def ja_tanken_root():
    # NOTE: Instead of doing this:
    # send_from_directory(TANKEN_BUILD_DIR, 'index.html')
    # we render this template, which is actually a symlink to tanken/build/index.html,
    # so that we don't have to deal with having two template directories.
    # This could be an issue if there was accidentally anything that looked like a template
    # substitution in the frontend code, but it works for now.
    return render_template('tanken_index.html')

@app.route("/ja/tanken/<path:name>")
def ja_tanken_sub(name):
    return send_from_directory(TANKEN_BUILD_DIR, name)

#
# MANIFOLD
#
MANIFOLD_BUILD_DIR = 'manifold/build'

@app.route('/ja/manifold')
@app.route('/ja/manifold/placement')
@app.route('/ja/manifold/quiz')
@app.route('/ja/manifold/settings')
def ja_manifold_root():
    # NOTE: Instead of doing this:
    # send_from_directory(MANIFOLD_BUILD_DIR, 'index.html')
    # we render this template, which is actually a symlink to manifold/build/index.html,
    # so that we don't have to deal with having two template directories.
    # This could be an issue if there was accidentally anything that looked like a template
    # substitution in the frontend code, but it works for now.
    return render_template('manifold_index.html')

@app.route("/ja/manifold/<path:name>")
def ja_manifold_sub(name):
    return send_from_directory(MANIFOLD_BUILD_DIR, name)

# remove trailing slash
@app.route('/ja/manifold/')
def ja_manifold_slash():
    return redirect('/ja/manifold')

#
# API
#

@app.route("/api/get_text_normal_counts", methods=['POST'])
def api_get_text_normals():
    req = request.get_json()
    text = req['text']
    morphemes = ja_get_text_morphemes(text)

    normal_counts = {}
    for (k, v) in ja_get_morphemes_normal_stats(morphemes).items():
        normal_counts[k] = v['c']

    return jsonify(normal_counts)

@app.route("/api/get_normal_fragments", methods=['POST'])
def api_get_normal_fragments():
    print(request.host_url)
    req = request.get_json()
    normal = req['normal']

    t0 = time.time()
    main_resp = requests.get(f'{ES_BASE_URL}/{FRAGMENT_INDEX}/_search', json={
        'query': {
            'match_phrase': {'normals': normal},
        },
        'sort': [
            {'mscore': 'desc'},
        ],
        'track_total_hits': False, # allows early termination, because we don't care about result count
        'size': 100,
    })
    dt = time.time() - t0
    main_resp.raise_for_status()
    print('es_request_time', f'{dt}', flush=True)

    main_resp_body = main_resp.json()
    fragments = []
    for hit in main_resp_body['hits']['hits']:
        fragments.append({
            'text': hit['_source']['text'],
            'normals': hit['_source']['normals'],
            'reading': hit['_source']['reading'],
        })

    return jsonify(fragments)

@app.route("/api/translate", methods=['POST'])
def api_translate():
    req = request.get_json()
    text = req['text']

    assert DEEPL_API_KEY, 'need DeepL API key'

    t0 = time.time()
    resp = requests.get('https://api-free.deepl.com/v2/translate', data={
        'auth_key': DEEPL_API_KEY,
        'source_lang': 'JA',
        'target_lang': 'EN',
        'split_sentences': '0',
        'text': text,
    })
    dt = time.time() - t0
    resp.raise_for_status()
    print('deepl_request_time', f'{dt}', flush=True)

    resp_body = resp.json()

    return jsonify({
        'translation': resp_body['translations'][0]['text'],
    })
