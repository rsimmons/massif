import sys
import subprocess

from sudachi import analyze_stream

if __name__ == '__main__':
    sys.stdin.reconfigure(encoding='utf-8')

    # start sudachi
    gen = analyze_stream()

    for line in sys.stdin:
        frag = line.strip()
        if not frag:
            continue

        # step generator-iterator to get analysis for this fragment
        next(gen)
        results = gen.send(frag)

        normals = [normal for (orig, fields_str, normal) in results]

        # print the result line for this fragment
        print('\t'.join([frag, '|'.join(normals)]))

    # finish iteration (weird)
    try:
        next(gen)
        gen.send(None)
    except StopIteration:
        pass
