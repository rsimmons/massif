#!/bin/bash
set -e

if [ -z "$1" ]; then
  echo "need hostname"
  exit 1
fi

cd $(git rev-parse --show-toplevel)
PREFIX=deploy-$(git rev-parse HEAD)
git archive --format=tar.gz --prefix=$PREFIX/ HEAD | ssh ubuntu@$1 "(cd /opt/massif && tar xfz - && ln -sfT $PREFIX latest && python3 -m venv /opt/massif/backend-env && /opt/massif/backend-env/bin/pip install -r /opt/massif/backend/requirements.txt)"
