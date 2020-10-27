#!/bin/bash
set -e
cd $(git rev-parse --show-toplevel)
PREFIX=batch-$(git rev-parse HEAD)
git archive --format=tar.gz --prefix=$PREFIX/ HEAD:batch | ssh ubuntu@$1 "(cd /opt/massif && tar xfz - && ln -s $PREFIX batch)"
