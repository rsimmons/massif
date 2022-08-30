#!/bin/bash
set -e

# build React SPAs
(cd pathfinder && yarn build)
(cd tanken && yarn build)
(cd manifold && yarn build)
(cd manifold2 && yarn build)

#### build deployment artifact for Elastic Beanstalk
# remove old build
rm build.zip
# start zip with local stuff
zip build.zip *.py requirements.txt
# add several dirs to zip, using find to get recursion
find .ebextensions static templates | zip build.zip -@
find pathfinder/build | zip build.zip -@
find tanken/build | zip build.zip -@
find manifold/build | zip build.zip -@
find manifold2/build | zip build.zip -@
# add common dir to zip, using flag to make it traverse symlink
find -L common | zip build.zip -@
