import sys
import json
import random

accum = None # this will be (text, [ref, ref, ...])

MAX_REFS = 20

def emit_accum():
    global accum
    if accum:
        shuf_refs = accum[1][:]
        random.shuffle(shuf_refs)
        print('%s\t%s' % (accum[0], json.dumps(shuf_refs[:MAX_REFS], sort_keys=True, ensure_ascii=False)))
    accum = None

if __name__ == "__main__":
    random.seed('massif') # to make stable during testing at least
    sys.stdin.reconfigure(encoding='utf-8')
    for line in sys.stdin:
        sline = line.strip('\n')
        if not sline:
            continue
        fields = sline.split('\t')

        # NOTE: we should be able to do:
        #   [text, src, loc, tags] = sline.split('\t')
        # but some text had extra tabs, so we have to adjust here
        if len(fields) > 4:
            print('EXTRA TAB', repr(sline), file=sys.stderr)
        text = fields[0]
        src = fields[-3]
        loc = fields[-2]
        tags = fields[-1]

        # TODO: temporary sanity check due to issue with extra tabs
        assert(tags.count(',') == 1)

        ref = {
            'src': src,
            'tags': tags,
        }
        if loc:
            ref['loc'] = loc

        if accum and (text == accum[0]):
            accum[1].append(ref)
        else:
            emit_accum()
            accum = (text, [ref])
    emit_accum()
