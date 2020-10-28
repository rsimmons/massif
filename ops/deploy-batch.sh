#!/bin/bash
set -e

if [ -z "$1" ]; then
  echo "need hostname"
  exit 1
fi

cd $(git rev-parse --show-toplevel)
PREFIX=batch-$(git rev-parse HEAD)
git archive --format=tar.gz --prefix=$PREFIX/ HEAD:batch | ssh ubuntu@$1 "(cd /opt/massif && tar xfz - && ln -sfT $PREFIX batch && python3 -m venv /opt/massif/batch-env && /opt/massif/batch-env/bin/pip install -r /opt/massif/batch/requirements.txt)"
