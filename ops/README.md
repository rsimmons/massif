# Ops

## Overview

The backend currently consists of:
* an Elasticsearch cluster (currently single-node), running directly on EC2 because we need custom plugins that aren't supported by AWS Elasticsearch
* a "batch" node to run crawling, indexing, etc.

To avoid hardcoding server IPs in these files, I've added entries to my local `/etc/hosts` for now.

## Cheat sheet

### Add EC2 SSH key

`ssh-add massif-ec2.pem`

### Configure hosts with Ansible

(after creating env in `ansible/`)

`cd ansible && ./configure.sh`

### Deploy backend/batch code

This is a hacky script to deploy the repo from local `HEAD`. It also creates/updates the server virtualenv.

`./deploy-backend.sh <hostname>`

### Manually run batches on server

Example:

```
$ cd /opt/massif
$ . backend-env/bin/activate
(copy-paste AWS secret/config exports from local file)
$ time python latest/backend/indexing/index_docs.py ja
```

### Manually restart Elasticsearch

(on the search server)

`sudo systemctl restart elasticsearch.service`
