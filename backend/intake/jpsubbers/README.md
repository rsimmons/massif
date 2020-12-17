# jpsubbers

This tool ingests files from the jpsubbers drama subtitles archive (most recently hosted at http://jpsubbers.xyz/) and uploads them to S3.

To simply things, we can first use wget to crawl the site. The tool then reads local files. E.g.:

```
wget --mirror --convert-links --adjust-extension --no-parent -e robots=off --wait=2 --limit-rate=100K http://jpsubbers.xyz/Japanese-Subtitles/
```

Note that wget only fixes up links after it finishes, so if you interrupt the job, the links are broken. With the above rate limit, crawling took a few hours, and the resulting dir was about 365M.

The tool handles a lot of crap that came up including different encodings, parsing years from paths, etc.
