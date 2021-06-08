import argparse
from collections import Counter

from sudachi import analyze_single
from filtering import include_for_refold

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('text')
    args = parser.parse_args()

    analyses = [a for a in analyze_single(open(args.text).read()) if include_for_refold(a)]

    normal_count = Counter(normal for (orig, analysis, normal) in analyses)

    normal_breakdown = {}
    for (orig, analysis, normal) in analyses:
        normal_breakdown.setdefault(normal, Counter())
        normal_breakdown[normal][(orig, analysis)] += 1

    for (normal, count) in normal_count.most_common(1000):
        print('\t'.join([normal, str(count)]))
        for ((orig, fields_str), count) in normal_breakdown[normal].most_common():
            print('  ' + '\t'.join([orig, fields_str, str(count)]))
        print()
