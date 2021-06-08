import argparse

from sudachi import analyze_single

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('knowntext', help='known text, in whatever format')
    parser.add_argument('sortedtoks', help='tsv of (text, toks) sorted by descending goodness')
    parser.add_argument('word', help='target word, in normal form')
    args = parser.parse_args()

    known_normals_set = set(normal for (orig, fields_str, normal) in analyze_single(open(args.knowntext).read()))
    print('Known count:', len(known_normals_set))
    print('Known set bytes size:', len('|'.join(known_normals_set).encode('utf-8')))

    if args.word in known_normals_set:
        print('Target word seems known already, but proceeding')
        known_normals_set.remove(args.word)

    line_count = 0
    for line in open(args.sortedtoks):
        line_count += 1
        sline = line.rstrip('\n')

        (text, toks_str) = sline.split('\t')

        toks_set = set(toks_str.split('|')) if toks_str else set()

        unknown_toks = toks_set.difference(known_normals_set)

        if args.word in unknown_toks:
            other_toks = unknown_toks.difference(set([args.word]))
            print('GOOD' if (len(other_toks) == 0) else 'NEED', text, other_toks or '', line_count)
