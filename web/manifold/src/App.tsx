import React from 'react';
import { useEffectReducer, EffectReducer, EffectsMap, InitialEffectStateGetter, EffectReducerExec } from "use-effect-reducer";

import { genRandomStr64, getUnixTime, invariant, randomChoice, UnreachableCaseError } from './util';

import './App.css';

const LEARNING_STEPS = [1*60, 10*60];
const GRADUATING_INTERVAL = 18*60*60;
const SUCCESS_MULT = 2.0;
const FAIL_EXP = 0.5;
const JITTER = 0.1; // as proportion of new interval after adjustment

const INITIAL_INTERVAL = LEARNING_STEPS[0];
const LAST_LEARNING_INTERVAL = LEARNING_STEPS[LEARNING_STEPS.length - 1];

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
  readonly atoms: ReadonlyMap<string, Atom>;
  readonly queue: ReadonlyArray<QueueItem>;

  // Unsaved state (UI, derived state)
  readonly mainUI: {
    readonly mode: 'overview';
  } | {
    readonly mode: 'quizLoadingTargetCtx';
  } | {
    readonly mode: 'quiz';
    readonly gradingRevealed: boolean;
    readonly fragmentText: string;
    readonly fragmentUnderstood: null | FragmentUnderstood;
    readonly targetAtom: null | {
      readonly atomId: string;
      readonly searchString: string;
      readonly remembered: null | AtomRemembered;
      readonly targetNotInFragment: boolean;
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
    readonly type: 'quizRcvdTargetCtxFragments';
    readonly atomId: string;
    readonly results: FragmentSearchResults;
  } | {
    readonly type: 'quizRevealGrading';
  } | {
    readonly type: 'quizUpdateFragmentUnderstood';
    readonly val: FragmentUnderstood;
  } | {
    readonly type: 'quizUpdateTargetAtomRemembered';
    readonly val: AtomRemembered;
  } | {
    readonly type: 'quizSubmitGrading';
  } | {
    readonly type: 'quizRefresh';
  };

type ManifoldEffect =
  {
    readonly type: 'quizSearchForTargetCtxFragments';
    readonly atomId: string;
  };

type ManifoldDispatch = React.Dispatch<ManifoldEvent>;
type ManifoldExec = EffectReducerExec<ManifoldState, ManifoldEvent, ManifoldEffect>;

function quizTargetAtom(state: ManifoldState, atomId: string, exec: ManifoldExec): ManifoldState {
  exec({
    type: 'quizSearchForTargetCtxFragments',
    atomId,
  });

  return {
    ...state,
    mainUI: {
      mode: 'quizLoadingTargetCtx',
    },
  };
}

// Based on atoms, queue, etc. set the current quiz state to be quizzing whatever is next, or give message that nothing is available
function quizNext(state: ManifoldState, exec: ManifoldExec): ManifoldState {
  // sort by ascending review time
  const sortedAtoms = [...state.atoms];
  sortedAtoms.sort(([, aAtom], [, bAtom]) => aAtom.rt - bAtom.rt);

  const curTime = getUnixTime();

  // Are there any atoms due to review?
  if ((sortedAtoms.length === 0) || (sortedAtoms[0][1].rt > curTime)) {
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

      // Add it to atoms
      const newAtomId = genRandomStr64();
      const newAtoms = new Map(state.atoms);
      const newAtom: Atom = {
        ss: removedItem.ss,
        rt: curTime,
        iv: INITIAL_INTERVAL,
        nt: '',
        rm: false,
      }
      newAtoms.set(newAtomId, newAtom);

      return quizTargetAtom({
        ...state,
        atoms: newAtoms,
        queue: newQueue,
      }, newAtomId, exec);
    }
  } else {
    // At least one atom due to review
    const [targetAtomId, ] = sortedAtoms[0];

    return quizTargetAtom(state, targetAtomId, exec);
  }
}

function getNewInterval(remembered: AtomRemembered, oldInterval: number): number {
  const jitter = (iv: number): number => {
    return (1 + 2*JITTER*(Math.random() - 0.5))*iv;
  };

  switch (remembered) {
    case 'y':
      if (oldInterval > LAST_LEARNING_INTERVAL) {
        // was already graduated
        return jitter(SUCCESS_MULT*oldInterval);
      } else {
        // was still in learning
        let nextLearningIterval: number | undefined;
        for (const iv of LEARNING_STEPS) {
          if (iv > oldInterval) {
            nextLearningIterval = iv;
            break;
          }
        }
        if (nextLearningIterval === undefined) {
          // graduates
          return jitter(GRADUATING_INTERVAL);
        } else {
          return nextLearningIterval;
        }
      }

    case 'n':
      if (oldInterval > LAST_LEARNING_INTERVAL) {
        // was already graduated
        return jitter(Math.pow(oldInterval, FAIL_EXP));
      } else {
        // was still in learning
        return INITIAL_INTERVAL;
      }

    default:
      throw new UnreachableCaseError(remembered);
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
      invariant(state.addWordPanel);

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

    case 'quizRcvdTargetCtxFragments': {
      const randomFragment = randomChoice(event.results.results);

      const atom = state.atoms.get(event.atomId);
      invariant(atom);

      return {
        ...state,
        mainUI: {
          mode: 'quiz',
          gradingRevealed: false,
          fragmentText: randomFragment.text,
          fragmentUnderstood: null,
          targetAtom: {
            atomId: event.atomId,
            searchString: atom.ss,
            remembered: null,
            targetNotInFragment: false,
          },
        },
      };
    }

    case 'quizRevealGrading':
      invariant(state.mainUI.mode === 'quiz');

      return {
        ...state,
        mainUI: {
          ...state.mainUI,
          gradingRevealed: true,
        },
      };

    case 'quizUpdateFragmentUnderstood':
      invariant(state.mainUI.mode === 'quiz');

      return {
        ...state,
        mainUI: {
          ...state.mainUI,
          fragmentUnderstood: event.val,
        },
      };

    case 'quizUpdateTargetAtomRemembered':
      invariant(state.mainUI.mode === 'quiz');
      invariant(state.mainUI.targetAtom !== null);

      return {
        ...state,
        mainUI: {
          ...state.mainUI,
          targetAtom: {
            ...state.mainUI.targetAtom,
            remembered: event.val,
          },
        },
      };

    case 'quizSubmitGrading': {
      invariant(state.mainUI.mode === 'quiz');
      invariant(state.mainUI.fragmentUnderstood !== null);
      invariant(state.mainUI.targetAtom !== null);
      invariant(state.mainUI.targetAtom.remembered !== null);

      const atomId = state.mainUI.targetAtom.atomId;
      const oldAtom = state.atoms.get(atomId);
      invariant(oldAtom);

      const newInterval = getNewInterval(state.mainUI.targetAtom.remembered, oldAtom.iv);
      const newAtom: Atom = {
        ...oldAtom,
        iv: newInterval,
        rt: getUnixTime() + newInterval,
      };

      const newAtoms = new Map(state.atoms);
      newAtoms.set(atomId, newAtom);

      console.log('atomId', atomId, 'oldAtom', oldAtom, 'newAtom', newAtom);

      return quizNext({
        ...state,
        atoms: newAtoms,
      }, exec);
    }

    case 'quizRefresh':
      invariant(state.mainUI.mode === 'nothingToQuiz');
      return quizNext(state, exec);
  }
}

const effectsMap: EffectsMap<ManifoldState, ManifoldEvent, ManifoldEffect> = {
  quizSearchForTargetCtxFragments: (state, effect, dispatch) => {
    (async () => {
      const atom = state.atoms.get(effect.atomId);
      invariant(atom);

      let response: Response;
      try {
        response = await fetch(MASSIF_URL_JA_FRAGMENT_SEARCH + '?' + new URLSearchParams({
          q: atom.ss,
          fmt: 'json',
        }), {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
          },
        });
      } catch {
        console.error('quizSearchForTargetCtxFragments fetch failed');
        // TODO: dispatch event
        return;
      }

      if (!response.ok) {
        console.error('quizSearchForTargetCtxFragments bad status');
        // TODO: dispatch event
        return;
      }

      // NOTE: We don't validate that this has the right shape
      const results = await response.json() as FragmentSearchResults;

      dispatch({
        type: 'quizRcvdTargetCtxFragments',
        atomId: effect.atomId,
        results,
      });
    })();
  },
};

const createInitialState: InitialEffectStateGetter<ManifoldState, ManifoldEvent, ManifoldEffect> = (exec) => {
  return {
    atoms: new Map(),
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

const RadioButtons: React.FC<{label: string, options: ReadonlyArray<{val: string, name: string}>, val: string | null, onUpdate: (newKey: string) => void}> = ({label, options, val, onUpdate}) => {
  return (
    <div>
      <span>{label}</span>{' '}
      {options.map(option => (
        <>
          <button
            key={option.val}
            onClick={() => {onUpdate(option.val)}}
            className={(val === option.val) ? 'App-RadioButtons-selected' : ''}
          >{option.name}</button>
          {' '}
        </>
      ))}
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
                {state.mainUI.gradingRevealed ? (
                  <div>
                    <RadioButtons
                      label={'Fragment Understood?'}
                      options={[
                        {val: 'y', name: 'Yes'},
                        {val: 'n', name: 'No'},
                        {val: 'u', name: 'Unsure'},
                      ]}
                      val={state.mainUI.fragmentUnderstood}
                      onUpdate={(newKey: string) => {dispatch({type: 'quizUpdateFragmentUnderstood', val: newKey as FragmentUnderstood})}}
                    />
                    {state.mainUI.targetAtom ? (
                      <>
                        <RadioButtons
                          label={'Target Remembered?'}
                          options={[
                            {val: 'y', name: 'Yes'},
                            {val: 'n', name: 'No'},
                          ]}
                          val={state.mainUI.targetAtom.remembered}
                          onUpdate={(newKey: string) => {dispatch({type: 'quizUpdateTargetAtomRemembered', val: newKey as AtomRemembered})}}
                        />
                        <div>
                          <button>Target Not In Fragment?</button>
                        </div>
                      </>
                    ) : null}
                    <div>
                      <button onClick={() => {dispatch({type: 'quizSubmitGrading'})}}>Continue</button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <button onClick={() => {dispatch({type: 'quizRevealGrading'})}}>Continue</button>
                  </div>
                )}
              </div>
            );

          case 'nothingToQuiz':
            return (
              <div>
                nothing due to review <button onClick={() => {dispatch({type: 'quizRefresh'})}}>Refresh</button>
              </div>
            );

          default:
            throw new UnreachableCaseError(state.mainUI);
        }
      })()}
    </div>
  );
}

export default App;
