import sys
import random
from collections import Counter
import json

NUM_WORDS = 5000

word_freq = [1.0/i for i in range(1, NUM_WORDS+1)]
sum_word_freq = sum(word_freq)

def pick_random_rank():
    r = sum_word_freq*random.random()
    for idx, freq in enumerate(word_freq):
        r -= freq
        if r < 0:
            return idx+1 # rank is idx + 1
    else:
        assert False, 'possible to get here with FP imprecision'

# pick a random "lexicon" of a virtual person, the set of word-ranks they know
def pick_random_lexicon_simple(size):
    lex = set()
    while len(lex) < size:
        lex.add(pick_random_rank())
    return lex

# this is a different way of picking, that gives different results. they are
# only considered to know a word if they have seen it at least `thresh` times
def pick_random_lexicon_thresh(size, thresh):
    counts = Counter()
    lex = set()
    while len(lex) < size:
        r = pick_random_rank()
        counts[r] += 1
        if counts[r] == thresh:
            lex.add(r)
    return lex

next_user_id = 1
for i in range(50, 3000, 30):
    lex = pick_random_lexicon_thresh(i, 10)

    # format for py-irt
    json_line = {
        'subject_id': f'u{next_user_id}',
        'responses': {f'w{r}': (1 if r in lex else 0) for r in range(1, NUM_WORDS+1) }
    }

    json.dump(json_line, sys.stdout)
    sys.stdout.write('\n')

    next_user_id += 1
