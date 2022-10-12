import { invariant } from "./util";

export interface TokenizedWord {
  // A word "spec" is its "specification", packed into a string.
  // In the simplest case, this will just be the text of the word, e.g. '食べる'.
  // But it could also be a multi-word phrase like '表情を浮かべる'.
  // TODO: We may also a quoted exact text like '"あろう"'.
  // Currently this is identical to a Massif search string, but this might
  // not always be the case.
  readonly spec: string;

  // tokenization of the word, joined with | chars. the details of this are complex
  readonly tokens: string;
}

function hashTokenizedWord(tword: TokenizedWord): string {
  // NOTE: when specs become more complicated, this will change
  return 'T' + tword.tokens;
}

export function tokenizedWordsAreSame(a: TokenizedWord, b: TokenizedWord): boolean {
  // NOTE: when specs become more complicated, this will change
  return a.tokens === b.tokens;
}

export interface WordIndex<V> {
  // map where key is the "hash" of a word
  // NOTE: right now there can be only one word for a given hash, but this
  // will not be true if we do crazy stuff in the future, in which case this
  // will need to become an array, no problem
  readonly hashMap: Map<string, {
    readonly tword: TokenizedWord;
    readonly value: V;
  }>;
}

export function createEmptyWordIndex<V>(): WordIndex<V> {
  return {
    hashMap: new Map(),
  };
}

export function addWordToWordIndex<V>(wordIndex: WordIndex<V>, tword: TokenizedWord, value: V): void {
  const h = hashTokenizedWord(tword);

  invariant(!wordIndex.hashMap.has(h));

  wordIndex.hashMap.set(h, {
    tword,
    value,
  });
}

export function getWordFromWordIndex<V>(wordIndex: WordIndex<V>, tword: TokenizedWord): V | undefined {
  const h = hashTokenizedWord(tword);

  const hit = wordIndex.hashMap.get(h);

  if (hit === undefined) {
    return undefined;
  }

  // this is guaranteed for now, but later we may need to find which hash-hit
  // actually matches
  invariant(tokenizedWordsAreSame(tword, hit.tword));

  return hit.value;
}
