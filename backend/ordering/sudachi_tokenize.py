import sys
import subprocess

from sudachi import CMD, IGNORE_SET

# We need to feed some uncommon character into sudachi to know where its output for a given
# input fragment ends. This is the "bell" character.
SUDACHI_FRAG_SEPARATOR = '\a'

if __name__ == '__main__':
    sys.stdin.reconfigure(encoding='utf-8')

    # start sudachi
    proc = subprocess.Popen(CMD, shell=True, encoding='utf-8', stdin=subprocess.PIPE, stdout=subprocess.PIPE)

    for line in sys.stdin:
        frag = line.strip()
        if not frag:
            continue
        assert SUDACHI_FRAG_SEPARATOR not in frag
        # print('DEBUG FRAG:', repr(frag))

        # write fragment to sudachi
        proc.stdin.write(frag + SUDACHI_FRAG_SEPARATOR + '\n')
        proc.stdin.flush()

        # read back all the token lines from sudachi until EOS
        accum_normals = []
        for line in proc.stdout:
            # print('DEBUG SUDACHI:', repr(line))
            sline = line.rstrip('\n')
            if SUDACHI_FRAG_SEPARATOR in sline:
                break # done with this fragment
            else:
                if sline == 'EOS':
                    continue # ignore. may sorta-mistakenly occur in the middle of fragments
                (orig, analysis, normal) = sline.split('\t')
                if not (analysis.startswith('補助記号,') or analysis.startswith('空白,')):
                    analysis_normal = '\t'.join([analysis, normal])
                    if analysis_normal not in IGNORE_SET:
                        # print('  ' + str((orig, analysis, normal)))
                        accum_normals.append(normal)

        # print the result line for this fragment
        print('\t'.join([frag, '|'.join(accum_normals)]))
