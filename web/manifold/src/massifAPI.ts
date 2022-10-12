import { invariant } from "./util";

// Globals set by Flask in index.html
declare const MASSIF_URL_JA_FRAGMENT_SEARCH: string;
declare const MASSIF_URL_API_TRANSLATE: string;

export class MassifAPIError extends Error {
  constructor(m?: string) {
    super(m);
    Object.setPrototypeOf(this, MassifAPIError.prototype);
  }
}

// note that this is a subset of what's actually returned
export interface FragmentResult {
  readonly text: string;
  readonly highlighted_html: string;
  readonly tokens: ReadonlyArray<ReadonlyArray<{
    readonly t: string; // token text
    readonly b: number; // begin index relative to text
    readonly e: number; // end index relative to text
  }>>;
}

export interface FragmentSearchResults {
  readonly results: ReadonlyArray<FragmentResult>;
}

export async function searchFragments(query: string): Promise<FragmentSearchResults> {
  let response: Response;
  try {
    response = await fetch(MASSIF_URL_JA_FRAGMENT_SEARCH + '?' + new URLSearchParams({
      q: query,
      fmt: 'json',
      toks: '1',
    }), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });
  } catch {
    throw new MassifAPIError('searchFragments fetch failed');
  }

  if (!response.ok) {
    throw new MassifAPIError('searchFragments bad status');
  }

  // NOTE: We don't validate that this has the right shape
  const results = await response.json() as FragmentSearchResults;

  return results;
}

export async function translateText(text: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(MASSIF_URL_API_TRANSLATE, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
      }),
    });
  } catch {
    throw new MassifAPIError('translateText fetch failed');
  }

  if (!response.ok) {
    throw new MassifAPIError('translateText bad status');
  }

  const result = await response.json();
  // NOTE: We don't validate that this has the right shape
  const translation = result.translation;
  invariant(translation);

  return translation;
}
