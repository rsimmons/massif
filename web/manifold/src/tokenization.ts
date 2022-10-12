export interface Token {
  readonly t: string; // token string (lemmatized/normalized)

  // NOTE: It is expected that this will be extended in some places to include
  // fields like start/end character offsets relative to the original text.
}

/**
 * A sequence of "contiguous" tokens. Sentence breaks or other breaks that
 * we should not match multi-token words/phrases across should cause a new
 * ContigTokenization to start. So a longer text would tokenize to a sequence
 * of ContigTokenizations. Tokens must also not be overlapping.
 */
export type ContigTokenization<T extends Token> = ReadonlyArray<T>;
