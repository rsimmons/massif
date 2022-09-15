import sys
import json
import numpy as np
import matplotlib.pyplot as plt

if len(sys.argv) < 2:
    print('need filename arg', file=sys.stderr)
    sys.exit(1)

with open(sys.argv[1]) as f:
    model = json.load(f)

item_idx_to_word_rank = {}
for k, v in model['item_ids'].items():
    item_idx = int(k)
    assert v.startswith('w')
    word_rank = int(v[1:])
    item_idx_to_word_rank[item_idx] = word_rank

word_rank_diff = {}
for i, diff in enumerate(model['diff']):
    rank = item_idx_to_word_rank[i]
    word_rank_diff[rank] = diff

diffs = [diff for (rank, diff) in sorted(word_rank_diff.items())]
# for d in diffs:
#     print(d)

plt.xscale('log')
# plt.yscale('log')
plt.scatter(word_rank_diff.keys(), word_rank_diff.values(), 1)
plt.show()
