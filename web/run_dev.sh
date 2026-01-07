#!/bin/bash
export FLASK_APP=application
export FLASK_DEBUG=1
flask run --host=0.0.0.0 "$@"
