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

### Deploy batch code

This is a hacky script to deploy the batch code from local `HEAD`. It also creates/updates the server virtualenv.

`./deploy-batch.sh <hostname>`

### Manually restart Elasticsearch

(on the search server)

`sudo systemctl restart elasticsearch.service`
