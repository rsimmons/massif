#!/bin/bash
export FLASK_APP=application
export FLASK_ENV=development
flask run "$@"
