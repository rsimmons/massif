import argparse

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument('sentence_file', nargs='+')
    args = parser.parse_args()

    file_sent_rank = {}
    all_sents = set()

    for fn in args.sentence_file:
        with open(fn, encoding='utf-8') as f:
            group_idx = 0
            group_size = 0
            sent_rank = {}
            for line in f:
                sline = line.strip()
                if sline.startswith('#'):
                    continue
                if not sline:
                    if group_size > 0:
                        group_idx += 1
                        group_size = 0
                        continue
                sent = sline.split('#')[0]
                all_sents.add(sent)
                sent_rank[sent] = group_idx
                group_size += 1

            file_sent_rank[fn] = sent_rank

    for sa in all_sents:
        for sb in all_sents:
            if sa > sb:
                # compare these across all files
                a_votes = 0
                b_votes = 0

                for fn, sent_rank in file_sent_rank.items():
                    ra = sent_rank.get(sa)
                    rb = sent_rank.get(sb)
                    if (ra is None) or (rb is None):
                        continue
                    if ra < rb:
                        a_votes += 1
                    elif rb < ra:
                        b_votes += 1

                if (a_votes + b_votes) < 2:
                    continue

                if a_votes and b_votes:
                    print('SOME_DISAGREE', sa, sb)
                else:
                    print('ALL_AGREE', sa, sb)
