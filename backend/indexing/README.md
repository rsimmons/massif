# Indexing

Current Elasticsearch index creation:
```
curl -X PUT "localhost:9200/fragment_ja_20210702?pretty" -H 'Content-Type: application/json' -d'
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
        "index_options": "offsets",
        "fields": {
          "wc": {
            "type": "wildcard"
          }
        }
      },
      "mscore": {
        "type": "float"
      },
      "tag_sets": {
        "type": "keyword"
      },
      "hits": {
        "type": "object",
        "enabled": false
      }
    }
  }
}'

curl -X PUT "localhost:9200/source_ja_syosetu_20210613?pretty" -H 'Content-Type: application/json' -d'
{
  "mappings": {
    "dynamic": "strict",
    "properties": {
      "title": {
        "type": "keyword",
        "index": false
      },
      "published": {
        "type": "date",
        "format": "strict_year||strict_date",
        "index": false
      },
      "url": {
        "type": "keyword",
        "index": false
      },
      "tags": {
        "type": "keyword",
        "index": false
      }
    }
  }
}'

curl -X POST "localhost:9200/_aliases?pretty" -H 'Content-Type: application/json' -d'
{
  "actions" : [
    { "remove" : { "index" : "*", "alias" : "fragment_ja" } },
    { "remove" : { "index" : "*", "alias" : "source_ja" } },
    { "add" : {
      "indices" : [
        "fragment_ja_20210702"
      ],
      "alias" : "fragment_ja"
    } },
    { "add" : {
      "indices" : [
        "source_ja_syosetu_20210613"
      ],
      "alias" : "source_ja"
    } }
  ]
}
'
```
