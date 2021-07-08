#!/bin/bash
set -e

# build React SPA
(cd frontend && yarn build)

#### build deployment artifact for Elastic Beanstalk
# remove old build
rm build.zip
# start zip with local stuff
zip build.zip *.py requirements.txt
# add several dirs to zip, using find to get recursion
find .ebextensions static templates frontend/build | zip build.zip -@
# add common dir to zip, using flag to make it traverse symlink
find -L common | zip build.zip -@
