import FREQ_LIST from './freqlist';
import { loadProfile, saveProfile } from './storage';

// Globals set by Flask in index.html
declare const MASSIF_URL_API_GET_NORMAL_FRAGMENTS: string;

export interface SuggestedFragment {
  readonly text: string;
  readonly reading: string;
  readonly normals: ReadonlyArray<string>; // should be unique tho
}

export interface SavedFragment {
  readonly uid: string;
  readonly text: string;
  readonly reading: string;
  readonly notes: string;
}

export type SavingFragmentState = SavedFragment; // for now the same, could have more state later

// invariant: If suggestedFragments are set (an array), then they match suggestedNormal
export interface State {
  readonly loading: boolean;
  readonly knownNormals: ReadonlySet<string>;
  readonly savedFragments: ReadonlyArray<SavedFragment>;

  readonly statusLog: ReadonlyArray<string>;
  readonly suggestedNormal: string | null;
  readonly suggestedFragments: ReadonlyArray<SuggestedFragment> | null | 'fetching'; // hacky union
  readonly savingFragment: SavingFragmentState | null; // if not null, the state of the pre-save form we're showing
}

export interface InitAction {
  readonly tag: 'init';
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

export interface DeleteSavedFragment {
  readonly tag: 'delete_saved_fragment';
  readonly fragmentId: string;
}

type Action = InitAction | AddKnownNormalsAction | SetSuggestedFragmentsAction | BeginSavingFragmentAction | UpdateSavingFragmentAction | FinishSavingFragmentAction | DeleteSavedFragment;

function genRandomStr32(): string {
  return Math.random().toString(16).substring(2, 10);
}
function genRandomStr64(): string {
  return genRandomStr32() + genRandomStr32();
}

function findNextSuggestedNormal(knownNormals: ReadonlySet<string>): string | null {
  for (const n of FREQ_LIST) {
    if (!knownNormals.has(n)) {
      return n;
    }
  }

  return null;
}

// Update suggestedNormal, and starts async update of suggestedFragments, based on rest of state.
const updateSuggestions = (s: State, dispatch: (a: Action) => void): State => {
  const newSuggestedNormal = findNextSuggestedNormal(s.knownNormals);
  if (newSuggestedNormal === s.suggestedNormal) {
    return s;
  } else if (newSuggestedNormal === null) {
    return {
      ...s,
      suggestedFragments: null,
    };
  } else {
    (async () => {
      const response = await fetch('MASSIF_URL_API_GET_NORMAL_FRAGMENTS', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          normal: newSuggestedNormal,
        }),
      });

      if (!response.ok) {
        throw new Error(); // TODO: handle
      }

      const content = await response.json();

      // NOTE: We don't validate that is has the right types

      dispatch({tag: 'set_suggested_fragments', fragments: content});
    })();

    return {
      ...s,
      suggestedNormal: newSuggestedNormal,
      suggestedFragments: 'fetching',
    };
  }
};

export function reducer(s: State, a: Action, dispatch: (a: Action) => void): State {
  switch (a.tag) {
    case 'init': {
      // Do initial load from storage
      const profile = loadProfile();

      const postLoadState: State = profile ? {
        ...s,
        loading: false,
        knownNormals: new Set(profile.knownNormals),
        savedFragments: profile.savedFragments,
      } : {
        ...s,
        loading: false,
      };

      return updateSuggestions(postLoadState, dispatch);
    }

    case 'add_known_normals': {
      const newKnownNormals = new Set([...s.knownNormals, ...a.normals]);

      saveProfile({
        knownNormals: newKnownNormals,
        savedFragments: s.savedFragments,
      });

      return updateSuggestions({
        ...s,
        knownNormals: newKnownNormals,
      }, dispatch);
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
          uid: genRandomStr64(),
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
      const newSavedFragments = s.savedFragments.concat([s.savingFragment]);
      const newState: State = {
        ...s,
        savedFragments: newSavedFragments,
        savingFragment: null,
      };

      saveProfile({
        knownNormals: newState.knownNormals,
        savedFragments: newState.savedFragments,
      });

      return newState;
    }

    case 'delete_saved_fragment': {
      const newState = {
        ...s,
        savedFragments: s.savedFragments.filter(frag => frag.uid !== a.fragmentId),
      };

      saveProfile({
        knownNormals: newState.knownNormals,
        savedFragments: newState.savedFragments,
      });

      return newState;
    }
  }
}

export const INITIAL_STATE: State = {
  loading: true,
  knownNormals: new Set(),
  savedFragments: [],

  statusLog: [],
  suggestedNormal: null,
  suggestedFragments: null,
  savingFragment: null,
};
