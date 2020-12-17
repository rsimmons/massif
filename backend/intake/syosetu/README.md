# Syosetu

This is crawling/ingest code for the Japanese user-generated novel site 小説家になろう (https://syosetu.com/).

One tool crawls the novel codes from search results.

```
$ python syosetu_codes.py > codes.txt
```

Another reads codes from stdin, crawls all chapters of the novel, extracts the good parts of the HTML, and uploads to S3. It supports (manually-specified) resuming if the crawl is interrupted.

```
$ cat codes.txt | python syosetu_novels.py
```
