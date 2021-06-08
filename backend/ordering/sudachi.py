import subprocess

CMD = 'java -jar ~/vendor/sudachi-0.5.2/sudachi-0.5.2.jar -m B -p ~/vendor/sudachi-0.5.2'

SUDACHI_FRAG_SEPARATOR = '\a'

# takes sudachi output line (without trailing newline, if any) and returns tuple (orig, analysis, normalized) or None
# this only filters the stuff we are totally sure we don't want to index on (particles and everything are still included)
def _filter_line(sline):
    if sline != 'EOS':
        (orig, fields_str, normal) = sline.split('\t')
        if not (fields_str.startswith('補助記号,') or fields_str.startswith('空白,')):
            return (orig, fields_str, normal)
    return None

# this is a generator-iterator
def analyze_stream():
    # start sudachi
    proc = subprocess.Popen(CMD, shell=True, encoding='utf-8', stdin=subprocess.PIPE, stdout=subprocess.PIPE)

    while True:
        frag = yield
        if frag is None:
            break

        assert SUDACHI_FRAG_SEPARATOR not in frag
        # print('DEBUG FRAG:', repr(frag))

        # write fragment to sudachi
        proc.stdin.write(frag + SUDACHI_FRAG_SEPARATOR + '\n')
        proc.stdin.flush()

        # read back all the token lines from sudachi until the separator
        accum_results = []
        for line in proc.stdout:
            # print('DEBUG SUDACHI:', repr(line))
            sline = line.rstrip('\n')
            if SUDACHI_FRAG_SEPARATOR in sline:
                break # done with this fragment
            else:
                maybe_result = _filter_line(sline)
                if maybe_result is not None:
                    accum_results.append(maybe_result)

        yield accum_results

def analyze_single(frag):
    completed = subprocess.run(CMD, shell=True, check=True, capture_output=True, encoding='utf-8', input=frag)

    accum_results = []
    for line in completed.stdout.split('\n'):
        if line.strip():
            maybe_result = _filter_line(line)
            if maybe_result is not None:
                accum_results.append(maybe_result)

    return accum_results

if __name__ == '__main__':
    print(analyze_single('これ。それ。学校\nに行った。'))
