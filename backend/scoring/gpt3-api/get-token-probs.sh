#!/bin/bash

curl https://api.openai.com/v1/engines/davinci/completions \
-H "Content-Type: application/json" \
-H "Authorization: Bearer $OPENAI_API_KEY" \
-d '{"prompt": "My favorite thing about summer is long days.", "echo": true, "logprobs": 0, "max_tokens": 0}'
