import React from 'react';
import { useEffectReducer, EffectReducer, EffectsMap, InitialEffectStateGetter, EffectReducerExec } from "use-effect-reducer";

import './App.css';

// Globals set by Flask in index.html
declare const MASSIF_URL_JA_FRAGMENT_SEARCH: string;

interface Atom {
  readonly ss: string; // search string
  readonly rt: number; // review time (unix time, in seconds)
  readonly iv: number; // interval (in seconds)
  readonly nt: string; // user notes
  readonly rm: boolean; // removed
}

interface QueueItem {
  readonly ss: string; // search string
  readonly ta: number; // time added to queue (unix time, in seconds)
  readonly fq: number; // frequency in corpus (arbitrary units, just for sorting. this is cached from API queries)
}

type FragmentUnderstood = 'y' | 'n' | 'u';
type AtomRemembered = 'y' | 'n';

type AddWordPanelState = null | {
  readonly text: string;
}

interface ManifoldState {
  // Saved state
  readonly atoms: ReadonlyArray<Atom>;
  readonly queue: ReadonlyArray<QueueItem>;

  // Unsaved state (UI, derived state)
  readonly mainUI: {
    readonly mode: 'overview';
  } | {
    readonly mode: 'quizLoadingTargetCtx';
    readonly targetAtomSearchString: string;
  } | {
    readonly mode: 'quiz';
    readonly gradingRevealed: boolean;
    readonly fragmentText: string;
    readonly fragmentUnderstood: null | FragmentUnderstood;
    readonly targetAtom: null | {
      readonly searchString: string;
      readonly remembered: null | AtomRemembered;
    };
  } | {
    readonly mode: 'nothingToQuiz';
  };
  readonly addWordPanel: AddWordPanelState;
}

// note that this is a subset of what's actually returned
interface FragmentSearchResults {
  readonly results: ReadonlyArray<{
    readonly text: string;
  }>;
}

type ManifoldEvent =
  {
    readonly type: 'addWordPanelOpen';
  } | {
    readonly type: 'addWordPanelCancel';
  } | {
    readonly type: 'addWordPanelUpdateWord';
    readonly text: string;
  } | {
    readonly type: 'addWordPanelAdd';
  } | {
    readonly type: 'quizBegin';
  } | {
    readonly type: 'quizTargetCtxFragments';
    readonly searchString: string;
    readonly results: FragmentSearchResults;
  }

type ManifoldEffect =
  {
    readonly type: 'searchFragments';
    readonly searchString: string;
  };

type ManifoldDispatch = React.Dispatch<ManifoldEvent>;
type ManifoldExec = EffectReducerExec<ManifoldState, ManifoldEvent, ManifoldEffect>;

function getUnixTime(): number {
  return Math.floor(0.001*Date.now());
}

function randomChoice<T>(arr: ReadonlyArray<T>): T {
  if (arr.length < 1) {
    throw new Error();
  }
  return arr[Math.floor(Math.random() * arr.length)];
}

function quizTargetAtom(state: ManifoldState, targetAtomSearchString: string, exec: ManifoldExec): ManifoldState {
  exec({
    type: 'searchFragments',
    searchString: targetAtomSearchString,
  });

  return {
    ...state,
    mainUI: {
      mode: 'quizLoadingTargetCtx',
      targetAtomSearchString: targetAtomSearchString,
    },
  };
}

// Based on atoms, queue, etc. set the current quiz state to be quizzing whatever is next, or give message that nothing is available
function quizNext(state: ManifoldState, exec: ManifoldExec): ManifoldState {
  // sort by ascending review time
  const sortedAtoms = [...state.atoms];
  sortedAtoms.sort((a, b) => a.rt - b.rt);

  const curTime = getUnixTime();

  // Are there any atoms due to review?
  if ((sortedAtoms.length === 0) || (sortedAtoms[0].rt > curTime)) {
    // No atoms due to review

    // Are there any atoms to introduce from queue?
    if (state.queue.length === 0) {
      // Queue is empty
      return {
        ...state,
        mainUI: {
          mode: 'nothingToQuiz',
        },
      }
    } else {
      // Queue has something to introduce

      // Dequeue an item
      const removedItem = state.queue[0];
      const newQueue = state.queue.slice(1);

      return quizTargetAtom({
        ...state,
        queue: newQueue
      }, removedItem.ss, exec);
    }
  } else {
    // At least one atom due to review
    const targetAtom = sortedAtoms[0];

    return quizTargetAtom(state, targetAtom.ss, exec);
  }
}

const reducer: EffectReducer<ManifoldState, ManifoldEvent, ManifoldEffect> = (state, event, exec) => {
  switch (event.type) {
    case 'addWordPanelOpen':
      return {
        ...state,
        addWordPanel: {
          text: '',
        },
      };

    case 'addWordPanelCancel':
      return {
        ...state,
        addWordPanel: null,
      };

    case 'addWordPanelUpdateWord':
      return {
        ...state,
        addWordPanel: {
          ...state.addWordPanel,
          text: event.text,
        },
      };

    case 'addWordPanelAdd': {
      if (!state.addWordPanel) {
        throw new Error();
      }

      const newEntry: QueueItem = {
        ss: state.addWordPanel.text,
        ta: getUnixTime(),
        fq: 0, // stubbed
      };

      return {
        ...state,
        queue: [...state.queue, newEntry],
        addWordPanel: null,
      };
    }

    case 'quizBegin':
      return quizNext(state, exec);

    case 'quizTargetCtxFragments': {
      const randomFragment = randomChoice(event.results.results);

      return {
        ...state,
        mainUI: {
          mode: 'quiz',
          gradingRevealed: false,
          fragmentText: randomFragment.text,
          fragmentUnderstood: null,
          targetAtom: {
            searchString: event.searchString,
            remembered: null,
          },
        },
      };
    }
  }
}

const effectsMap: EffectsMap<ManifoldState, ManifoldEvent, ManifoldEffect> = {
  searchFragments: (_, effect, dispatch) => {
    (async () => {
      let response: Response;
      try {
        response = await fetch(MASSIF_URL_JA_FRAGMENT_SEARCH + '?' + new URLSearchParams({
          q: effect.searchString,
          fmt: 'json',
        }), {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
          },
        });
      } catch {
        console.error('searchFragments fetch failed');
        // TODO: dispatch event
        return;
      }

      if (!response.ok) {
        console.error('searchFragments bad status');
        // TODO: dispatch event
        return;
      }

      // NOTE: We don't validate that this has the right shape
      const results = await response.json() as FragmentSearchResults;

      dispatch({
        type: 'quizTargetCtxFragments',
        searchString: effect.searchString,
        results,
      });
    })();
  },
};

const createInitialState: InitialEffectStateGetter<ManifoldState, ManifoldEvent, ManifoldEffect> = (exec) => {
  return {
    atoms: [],
    queue: [],
    mainUI: {
      mode: 'overview',
    },
    addWordPanel: null,
  };
}

// this may render to the opened panel or just the button
const AddWordPanel: React.FC<{localState: AddWordPanelState, dispatch: ManifoldDispatch}> = ({localState, dispatch}) => {
  const handleChangeWord = (event: React.ChangeEvent<HTMLInputElement>) => {
    dispatch({type: 'addWordPanelUpdateWord', text: event.target.value});
  };

  return (localState === null) ? (
    <button onClick={() => {dispatch({type: 'addWordPanelOpen'})}}>Add Word</button>
  ) : (
    <div className="App-AddWordPanel">
      <input type="text" value={localState.text} onChange={handleChangeWord} />{' '}
      <button onClick={() => {dispatch({type: 'addWordPanelAdd'})}}>Add</button>{' '}
      <button onClick={() => {dispatch({type: 'addWordPanelCancel'})}}>Cancel</button>
    </div>
  );
}

const App: React.FC = () => {
  const [state, dispatch] = useEffectReducer(reducer, createInitialState, effectsMap);

  return (
    <div className="App">
      <div>Manifold</div>
      <AddWordPanel localState={state.addWordPanel} dispatch={dispatch} />
      {(() => {
        switch (state.mainUI.mode) {
          case 'overview':
            return (
              <div>
                <div>{state.queue.length} in queue</div>
                <div><button onClick={() => {dispatch({type: 'quizBegin'})}}>Study</button></div>
              </div>
            );

          case 'quizLoadingTargetCtx':
            return (
              <div>
                quizLoadingTargetCtx
              </div>
            );

          case 'quiz':
            return (
              <div>
                {state.mainUI.fragmentText}
              </div>
            );

          case 'nothingToQuiz':
            return (
              <div>
                nothing to quiz
              </div>
            );

          default:
            throw new Error();
        }
      })()}
    </div>
  );
}

export default App;
