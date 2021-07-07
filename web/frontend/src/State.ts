import FREQ_LIST from './freqlist';

export interface SuggestedFragment {
  readonly text: string;
  readonly reading: string;
  readonly normals: ReadonlyArray<string>; // should be unique tho
}

export interface State {
  readonly statusLog: ReadonlyArray<string>;
  readonly knownNormals: ReadonlySet<string>;
  readonly suggestedNormal: string | null;
  readonly suggestedFragments: ReadonlyArray<SuggestedFragment> | null | 'fetching'; // hacky union
}

export interface LogStatusAction {
  readonly tag: 'log_status';
  readonly status: string;
}

export interface AddKnownNormalsAction {
  readonly tag: 'add_known_normals';
  readonly normals: ReadonlyArray<string>;
}

export interface SetSuggestedFragmentsAction {
  readonly tag: 'set_suggested_fragments';
  readonly fragments: ReadonlyArray<SuggestedFragment> | 'fetching';
}

type Action = LogStatusAction | AddKnownNormalsAction | SetSuggestedFragmentsAction;

function findNextSuggestedNormal(knownNormals: ReadonlySet<string>): string | null {
  for (const n of FREQ_LIST) {
    if (!knownNormals.has(n)) {
      return n;
    }
  }

  return null;
}

export function reducer(s: State, a: Action): State {
  switch (a.tag) {
    case 'log_status': {
      return {
        ...s,
        statusLog: s.statusLog.concat([a.status]),
      };
    }

    case 'add_known_normals': {
      const newKnownNormals = new Set([...s.knownNormals, ...a.normals]);
      const newSuggestedNormal = findNextSuggestedNormal(newKnownNormals);
      return {
        ...s,
        knownNormals: newKnownNormals,
        suggestedNormal: newSuggestedNormal,
        // clear suggestedFragments if suggestedNormal changed
        suggestedFragments: (newSuggestedNormal === s.suggestedNormal) ? s.suggestedFragments : null,
      };
    }

    case 'set_suggested_fragments': {
      return {
        ...s,
        suggestedFragments: a.fragments,
      };
    }
  }
}

export const INITIAL_STATE: State = {
  statusLog: [],
  knownNormals: new Set(),
  suggestedNormal: null,
  suggestedFragments: null,
};
