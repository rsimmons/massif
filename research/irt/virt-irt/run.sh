#!/bin/bash

set -e # stop on error
set -x # echo commands

python sim.py > sim-out.jsonl
rm -rf trained
py-irt train 1pl sim-out.jsonl trained --epochs 5000
python an.py trained/best_parameters.json
