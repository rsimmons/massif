// Globals set by Flask in index.html
declare const MASSIF_URL_JA_FRAGMENT_SEARCH: string;

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
