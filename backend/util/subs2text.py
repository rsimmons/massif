import argparse
import pysubs2

PAREN_CLOSER = {
    '（': '）',
    '(': ')',
}
ALL_PARENS = ''.join(k+v for (k, v) in PAREN_CLOSER.items())

def remove_parenthesized(text):
    stack = []
    result = []
    for c in text:
        if c in PAREN_CLOSER:
            stack.append(c)
        elif stack and (c == PAREN_CLOSER[stack[-1]]):
            stack.pop()
        elif c in ALL_PARENS:
            # unbalanced, ignore
            pass
        else:
            if not stack:
                result.append(c)

    return ''.join(result)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument('subfile', nargs='+')
    args = parser.parse_args()

    for subfn in args.subfile:
        subs = pysubs2.load(subfn, encoding='utf-8')
        subs.remove_miscellaneous_events()
        for line in subs:
            t = line.plaintext
            t = remove_parenthesized(t)
            t = t.strip().strip('　')
            if t:
                print(t)
