import { ContigTokenization, Token } from "./tokenization";

/**
 * Type parameters of types/funcs below are as follows:
 * - TW: "trie word", subtype of TrieWord used by trie (dictionary) words
 * - WT: "word token", subtype of Token used in tokenization of trie (dictionary) words
 * - TT: "text token", subtype of Token used in tokenization of given-text (fragment) words
 */

export interface TrieWord<WT extends Token> {
  readonly toks: ContigTokenization<WT>;
  // NOTE: This is expected to have other fields used by calling code
}

export interface Trie<WT extends Token, TW extends TrieWord<WT>> {
  readonly root: TrieNode<WT, TW>;
}

interface TrieNode<WT extends Token, TW extends TrieWord<WT>> {
  readonly words: Array<TW>;
  readonly children: Map<string, TrieNode<WT, TW>>;
}

export function createEmptyTrie<WT extends Token, TW extends TrieWord<WT>>(): Trie<WT, TW> {
  return {
    root: {
      words: [],
      children: new Map(),
    },
  };
}

export function addWordToTrie<WT extends Token, TW extends TrieWord<WT>>(trie: Trie<WT, TW>, word: TW) {
  let node = trie.root;

  for (let i = 0; i < word.toks.length; i++) {
    const tokRange = word.toks[i];
    const t = tokRange.t;

    if (!node.children.has(t)) {
      const newChild: TrieNode<WT, TW> = {
        words: [],
        children: new Map(),
      };
      node.children.set(t, newChild);
      node = newChild;
      if (i === (word.toks.length - 1)) {
        newChild.words.push(word);
      }
    }
  }
}

export function buildTrie<WT extends Token, TW extends TrieWord<WT>>(words: ReadonlyArray<TW>): Trie<WT, TW> {
  const trie = createEmptyTrie<WT, TW>();

  for (const word of words) {
    addWordToTrie(trie, word);
  }

  return trie;
}

export interface FindResult<WT extends Token, TW extends TrieWord<WT>, TT extends Token> {
  readonly words: ReadonlyArray<TW>;
  readonly unmatched: ReadonlyArray<TT>;
}

export function findWordsInText<WT extends Token, TW extends TrieWord<WT>, TT extends Token>(trie: Trie<WT, TW>, textToks: ContigTokenization<TT>): FindResult<WT, TW, TT> {
  let partials: ReadonlyArray<[TrieNode<WT, TW>, ContigTokenization<TT>]> = [[trie.root, []]];
  const foundWords: Array<TW> = [];
  const unmatchedToks: Set<TT> = new Set(textToks);

  for (const textTok of textToks) {
    const t = textTok.t;

    const newPartials: Array<[TrieNode<WT, TW>, ContigTokenization<TT>]> = [];

    for (const [pNode, pToks] of partials) {
      const n = pNode.children.get(t);
      if (n !== undefined) {
        const newPToks = [...pToks, textTok]
        for (const w of n.words) {
          foundWords.push(w);
          for (const pt of newPToks) {
            unmatchedToks.delete(pt);
          }
        }
        newPartials.push([n, newPToks]);
      }
    }

    newPartials.push([trie.root, []]);

    partials = newPartials;
  }

  return {
    words: foundWords,
    unmatched: [...unmatchedToks],
  };
}
