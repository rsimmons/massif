#!/bin/bash
set -e
cd $(git rev-parse --show-toplevel)
PREFIX=massif-$(git rev-parse HEAD)
git archive --format=tar.gz --prefix=$PREFIX/ HEAD:batch | ssh ubuntu@$1 "(cd /tmp && tar xfz - && ln -s $PREFIX massif)"
