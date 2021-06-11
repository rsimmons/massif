# Indexing

Current Elasticsearch index creation:
```
curl -X DELETE "localhost:9200/fragment_ja_syosetu_20210609?pretty"

curl -X PUT "localhost:9200/fragment_ja_syosetu_20210609?pretty" -H 'Content-Type: application/json' -d'
{
  "settings": {
    "index": {
      "sort.field": "mscore",
      "sort.order": "desc"
    },
    "analysis": {
      "analyzer": {
      "massif_ja_text": {
          "type":"custom",
          "tokenizer": "sudachi_tokenizer",
          "filter": [
            "keyword_repeat",
            "sudachi_normalizedform",
            "remove_duplicates",
            "stop"
          ]
        }
      }
    }
  },
  "mappings": {
    "dynamic": "strict",
    "properties": {
      "text": {
        "type": "text",
        "analyzer": "massif_ja_text",
        "index_options": "offsets"
      },
      "mscore": {
        "type": "float"
      }
    }
  }
}'

curl -X POST "localhost:9200/_aliases?pretty" -H 'Content-Type: application/json' -d'
{
  "actions" : [
    { "remove" : { "index" : "*", "alias" : "fragment_ja" } },
    { "add" : {
      "indices" : [
        "fragment_ja_syosetu_20210609"
      ],
      "alias" : "fragment_ja"
    } }
  ]
}'
```
