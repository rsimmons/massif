#!/bin/bash
mkdir /opt/massif
chown ubuntu:ubuntu /opt/massif
chmod 755 /opt/massif
sudo -i -u ubuntu bash << EOF
cd /opt/massif
source activate tensorflow_p37
pip install jaconv
git clone https://github.com/tanreinama/gpt2-japanese
cd gpt2-japanese
wget https://massif-public.s3-us-west-2.amazonaws.com/gpt2ja-medium.tar.bz2
tar xvfj gpt2ja-medium.tar.bz2
curl -O https://raw.githubusercontent.com/rsimmons/massif/master/backend/scoring/gpt2-ja/score.py
EOF
