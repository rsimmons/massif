import json
from .fragment_doc import fragment_srt, fragment_syosetu, has_unbalanced_quotes, extract_kana_kanji

EXTRACT_KANA_KANJI_CASES = [
    ['asdf.!ä', ''],
    ['あいうえお', 'あいうえお'],
    ['asdこfdれ', 'これ'],
    ['「ああ、畜生」foo', 'ああ畜生'],
]

for [text, target] in EXTRACT_KANA_KANJI_CASES:
    if extract_kana_kanji(text) != target:
        print('FAIL EXTRACT KANA+KANJI')
        print(text)

QUOTE_BALANCE_CASES = [
    ['あいうえお', False],
    ['あい「うえお', True],
    ['「あいうえお', True],
    ['「あいうえお」', False],
    ['あい「うえ」お', False],
    ['「あい」う「えお」', False],
    ['「あいう「えお」」', False],
    ['「あい「うえ」お', True],
    ['あい「うえ」お」', True],
]

for [text, target] in QUOTE_BALANCE_CASES:
    if has_unbalanced_quotes(text) != target:
        print('FAIL QUOTE BALANCE')
        print(text)

FRAG_CASES = [
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

    # no anchor novel
    ['N', '<div><p>食べる</p></div>', [{'text': "食べる"}]],

    # anchor novel
    ['N', '<div><p id="L123">食べる</p></div>', [{'text': '食べる', 'loc': 'a:L123'}]],

    # no splitting
    ['N', '<div><p>それでは、行ってまいります</p></div>',
        [
            {'text': 'それでは、行ってまいります'},
        ]
    ],

    # simple splitting
    ['N', '<div><p>そのせいだろうか。あの日に見た空の青を、よく覚えている。</p></div>',
        [
            {'text': 'そのせいだろうか。'},
            {'text': 'あの日に見た空の青を、よく覚えている。'},
        ]
    ],

    # strip leading dashes
    ['N', '<div><p>――ああ、そうだったのですか。</p></div>',
        [
            {'text': 'ああ、そうだったのですか。'},
        ]
    ],

    # strip leading ellipses
    ['N', '<div><p>……そうか？</p></div>',
        [
            {'text': 'そうか？'},
        ]
    ],

    # strip matching quotes
    ['N', '<div><p>「ああ、畜生」</p></div>',
        [
            {'text': 'ああ、畜生'},
        ]
    ],

    # strip just leading open quote
    ['N', '<div><p>「あっ、大丈夫です！</p></div>',
        [
            {'text': 'あっ、大丈夫です！'},
        ]
    ],

    # strip just trailing close quote
    ['N', '<div><p>王宮に神父がいるかっ」</p></div>',
        [
            {'text': '王宮に神父がいるかっ'},
        ]
    ],

    # combo
    ['N', '<div><p>「……うん」</p></div>',
        [
            {'text': 'うん'},
        ]
    ],

    # don't strip trailing ellipses
    ['N', '<div><p>「……血……血が……………」</p></div>',
        [
            {'text': '血……血が……………'},
        ]
    ],

    # ignore fragments that start with close quote
    ['N', '<div><p>」と見開いた。</p></div>', []],

    # handle other quotes
    ['N', '<div><p>『モルツ、少し休憩する』</p></div>',
        [
            {'text': 'モルツ、少し休憩する'},
        ]
    ],

    # remove leading speaker label
    ['N', '<div><p>【ポルペオ】「なんだ、その目は？</p></div>',
        [
            {'text': 'なんだ、その目は？'},
        ]
    ],

    # remove drama-style speaker label
    ['N', '<div><p>（平次）おい　大変だ。</p></div>',
        [
            {'text': 'おい　大変だ。'},
        ]
    ],

    # TODO: can we get rid of the leading dash?
    # ['N', '<div><p id="L75">─ 〝城内〟に命ず。騎士団による警備を撤去せよ。</p></div>',
    #     [
    #         {'text': '〝城内〟に命ず。', 'loc': 'a:L75'},
    #         {'text': '騎士団による警備を撤去せよ。', 'loc': 'a:L75'}
    #     ]
    # ],
]

for [kind, text, expected_result] in FRAG_CASES:
    if kind == 'S':
        result = fragment_srt(text, None)
    elif kind == 'N':
        result = fragment_syosetu(text, None)
    else:
        assert False

    # this is hacky, but should be OK
    if json.dumps(result, sort_keys=True) != json.dumps(expected_result, sort_keys=True):
        print('FAIL')
        print('TEXT-----------------')
        print(text)
        print('TARGET RESULT--------')
        print(repr(expected_result))
        print('ACTUAL RESULT--------')
        print(repr(result))
        print()
