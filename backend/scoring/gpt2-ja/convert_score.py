import sys

from ...util.count_chars import count_meaty_chars

if __name__ == "__main__":
    sys.stdin.reconfigure(encoding='utf-8')
    for line in sys.stdin:
        sline = line.strip('\n')
        if not sline:
            continue
        [text, logprob_str] = sline.split('\t')
        logprob = float(logprob_str)
        chars = count_meaty_chars(text)
        print('%s\t%.5g' % (text, logprob/chars))
