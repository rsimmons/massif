import FREQ_LIST from './freqlist';

export interface SuggestedFragment {
  readonly text: string;
  readonly reading: string;
  readonly normals: ReadonlyArray<string>; // should be unique tho
}

export interface SavedFragment {
  readonly text: string;
  readonly reading: string;
  readonly notes: string;
}

export type SavingFragmentState = SavedFragment; // for now the same, could have more state later

export interface State {
  readonly knownNormals: ReadonlySet<string>;
  readonly savedFragments: ReadonlyArray<SavedFragment>;

  readonly statusLog: ReadonlyArray<string>;
  readonly suggestedNormal: string | null;
  readonly suggestedFragments: ReadonlyArray<SuggestedFragment> | null | 'fetching'; // hacky union
  readonly savingFragment: SavingFragmentState | null; // if not null, the state of the pre-save form we're showing
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

export interface BeginSavingFragmentAction {
  readonly tag: 'begin_saving_fragment';
  readonly fragment: SuggestedFragment;
}

export interface UpdateSavingFragmentAction {
  readonly tag: 'update_saving_fragment';
  readonly fragment: SavingFragmentState;
}

export interface FinishSavingFragmentAction {
  readonly tag: 'finish_saving_fragment';
}

type Action = LogStatusAction | AddKnownNormalsAction | SetSuggestedFragmentsAction | BeginSavingFragmentAction | UpdateSavingFragmentAction | FinishSavingFragmentAction;

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

    case 'begin_saving_fragment': {
      const sugFrag = a.fragment;
      return {
        ...s,
        savingFragment: {
          text: sugFrag.text,
          reading: sugFrag.reading,
          notes: '',
        },
      };
    }

    case 'update_saving_fragment': {
      return {
        ...s,
        savingFragment: a.fragment,
      };
    }

    case 'finish_saving_fragment': {
      if (!s.savingFragment) {
        throw new Error('should be unreachable');
      }
      return {
        ...s,
        savedFragments: s.savedFragments.concat([s.savingFragment]),
        savingFragment: null,
      };
    }
  }
}

export const INITIAL_STATE: State = {
  knownNormals: new Set(),
  savedFragments: [],

  statusLog: [],
  suggestedNormal: null,
  suggestedFragments: null,
  savingFragment: null,
};
