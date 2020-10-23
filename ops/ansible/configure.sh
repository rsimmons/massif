#!/bin/bash
ansible-playbook -i hosts -u ubuntu main.yml "$@"
