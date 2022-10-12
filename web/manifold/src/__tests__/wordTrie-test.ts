import { Token } from '../tokenization';
import { buildTrie, findWordsInText, TrieWord } from '../wordTrie';

interface Word extends TrieWord<Token> {
  readonly text: string;
}

interface TokenWithOffsets extends Token {
  readonly s: number; // start offset
  readonly e: number; // end offset
}

const TEST_WORDS: ReadonlyArray<Word> = [
  {
    text: 'は',
    toks: [{t: 'は'}],
  },
  {
    text: 'これ',
    toks: [{t: '此れ'}],
  },
  {
    text: 'この',
    toks: [{t: '此の'}],
  },
  {
    text: 'その',
    toks: [{t: '其の'}],
  },
  {
    text: 'カメラ',
    toks: [{t: 'カメラ'}],
  },
  {
    text: '通じる',
    toks: [{t: '通ずる'}]
  },
  {
    text: 'を通じて', // multi-token phrase/pattern
    toks: [
      {t: 'を'},
      {t: '通ずる'},
      {t: 'て'},
    ],
  },
];

test('building empty trie', () => {
  expect(() => {
    buildTrie([]);
  }).not.toThrow();
});

test('building trie', () => {
  expect(() => {
    buildTrie(TEST_WORDS);
  }).not.toThrow();
});

test('finding words', () => {
  const FRAG_TOKS: ReadonlyArray<TokenWithOffsets> = [ // 千尋はこのカメラを通じて
    {s: 0, e: 2, t: '千尋'},
    {s: 2, e: 3, t: 'は'},
    {s: 3, e: 5, t: '此の'},
    {s: 5, e: 7, t: '黒い'},
    {s: 7, e: 10, t: 'カメラ'},
    {s: 10, e: 11, t: 'を'},
    {s: 11, e: 14, t: '通ずる'},
    {s: 14, e: 15, t: 'て'},
  ];

  const trie = buildTrie(TEST_WORDS);

  // console.log(util.inspect(trie, {showHidden: false, depth: null, colors: true}));

  const result = findWordsInText(trie, FRAG_TOKS);

  // console.log(util.inspect(result, {showHidden: false, depth: null, colors: true}));

  expect(result.words.map(w => w.text)).toEqual([
    'は',
    'この',
    'カメラ',
    '通じる',
    'を通じて',
  ]);

  expect(result.unmatched).toEqual([
    {s: 0, e: 2, t: '千尋'},
    {s: 5, e: 7, t: '黒い'},
  ]);
});

test('finding words with contig unmatched at end', () => {
  const FRAG_TOKS: ReadonlyArray<TokenWithOffsets> = [ // 千尋はこのカメラを
    {s: 0, e: 2, t: '千尋'},
    {s: 2, e: 3, t: 'は'},
    {s: 3, e: 5, t: '此の'},
    {s: 5, e: 7, t: '黒い'},
    {s: 7, e: 10, t: 'カメラ'},
    {s: 10, e: 11, t: 'を'},
    {s: 11, e: 14, t: '食べる'},
  ];

  const trie = buildTrie(TEST_WORDS);
  const result = findWordsInText(trie, FRAG_TOKS);
  expect(result.words.map(w => w.text)).toEqual([
    'は',
    'この',
    'カメラ',
  ]);

  expect(result.unmatched).toEqual([
    {s: 0, e: 2, t: '千尋'},
    {s: 5, e: 7, t: '黒い'},
    {s: 10, e: 11, t: 'を'},
    {s: 11, e: 14, t: '食べる'},
  ]);
});
