from flask import Flask, request, render_template
import requests

app = Flask(__name__)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/search')
def search():
    query = request.args.get('q', '')
    print('query is', query)

    resp = requests.get(f'http://localhost:9200/ja_sent_main/_search', json={
        'query': {
            'match_phrase': {
                'text': query,
            },
        },
        'highlight': {
            'fields': {
                'text': {},
            },
        },
    })
    resp.raise_for_status()

    resp_body = resp.json()
    print(resp_body)
    hits = resp_body['hits']['hits']

    return render_template('index.html', query=query, hits=hits)

application = app # for EB

if __name__ == "__main__":
    app.debug = True
    app.run()
