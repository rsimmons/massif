#!/bin/bash
set -e

# build React SPA
(cd frontend && yarn build)

# build deployment artifact for Elastic Beanstalk
rm build.zip
zip build.zip *.py requirements.txt
#find .elasticbeanstalk .ebextensions static templates frontend/build | zip build.zip -@
find .ebextensions static templates frontend/build | zip build.zip -@
