import json
from .fragment_doc import fragment_srt, fragment_syosetu

CASES = [
    ['S',
'''
1
00:02:17,440 --> 00:02:20,375
Senator, we're making
our final approach into Coruscant.

2
00:02:20,476 --> 00:02:22,501
Very good, Lieutenant.
''',
        [
            {'text': "Senator, we're making our final approach into Coruscant.", 'loc': 't:137.440-140.375'},
            {'text': 'Very good, Lieutenant.', 'loc': 't:140.476-142.501'},
        ]
    ],

    ['N', '<div><p>Foo bar baz</p></div>', [{'text': "Foo bar baz"}]],

    ['N', '<div><p id="L123">Foo bar baz</p></div>', [{'text': 'Foo bar baz', 'loc': 'a:L123'}]],

    # TODO: can we get rid of the leading dash?
    ['N', '<div><p id="L75">─ 〝城内〟に命ず。騎士団による警備を撤去せよ。</p></div>',
        [
            {'text': '─ 〝城内〟に命ず。', 'loc': 'a:L75'},
            {'text': '騎士団による警備を撤去せよ。', 'loc': 'a:L75'}
        ]
    ],
]

for [kind, text, expected_result] in CASES:
    if kind == 'S':
        result = fragment_srt(text)
    elif kind == 'N':
        result = fragment_syosetu(text)
    else:
        assert False

    # this is hacky, but should be OK
    if json.dumps(result, sort_keys=True) != json.dumps(expected_result, sort_keys=True):
        print('FAIL')
        print('TEXT-----------------')
        print(text)
        print('TARGET RESULT--------')
        print(repr(result))
        print('ACTUAL RESULT--------')
        print(repr(expected_result))
