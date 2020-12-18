import sys
import argparse
import random
import os

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument('sentence_file')
    parser.add_argument('--overlap', type=int, required=True) # each sentence should be done by this many people
    parser.add_argument('--people', type=int, required=True) # how many people we have to work with
    parser.add_argument('--randseed', default='foobar')
    args = parser.parse_args()

    random.seed(args.randseed)

    sents = []

    with open(args.sentence_file, encoding='utf-8') as f:
        for line in f:
            sline = line.strip()
            if not sline:
                continue
            sents.append(sline)

    random.shuffle(sents)

    if (len(sents) % args.people) != 0:
        print('does not divide evenly')
        sys.exit(1)

    batch_size = len(sents)*args.overlap // args.people
    print(f'batch size of {batch_size} per person')

    offset = len(sents) // args.people

    doubled_sents = sents + sents
    idx = 0
    for i in range(args.people):
        batch = doubled_sents[idx:idx+batch_size]
        root, ext = os.path.splitext(args.sentence_file)
        outfn = root + '_batch' + str(i+1) + ext
        print('writing', outfn)
        with open(outfn, 'w', encoding='utf-8') as outf:
            for s in batch:
                outf.write(s + '\n')
        idx += offset
