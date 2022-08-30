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

const LOCAL_STORAGE_KEY = 'massif-manifold-v1';

// Globals set by Flask in index.html
declare const MASSIF_URL_JA_FRAGMENT_SEARCH: string;
declare const MASSIF_URL_API_TRANSLATE: string;

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

type FragmentTranslation =
  {
    type: 'none';
  } | {
    type: 'loading';
  } | {
    type: 'loaded';
    translation: string;
  };

type AddWordPanelState = {
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
    readonly fragmentTranslation: FragmentTranslation;
    readonly fragmentUnderstood: null | FragmentUnderstood;
    readonly targetAtom: null | {
      readonly fragmentHighlightedHTML: string;
      readonly atomId: string;
      readonly searchString: string;
      readonly remembered: null | AtomRemembered;
      readonly targetNotInFragment: boolean;
    };
  } | {
    readonly mode: 'nothingToQuiz';
  };
  readonly addWordPanel: AddWordPanelState;
  readonly atomsAn: AtomsAnalysis; // used for stats display
}

// note that this is a subset of what's actually returned
interface FragmentSearchResults {
  readonly results: ReadonlyArray<{
    readonly text: string;
    readonly highlighted_html: string;
  }>;
}

type ManifoldEvent =
  {
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
    readonly type: 'quizToggleTargetNotInFragment';
  } | {
    readonly type: 'quizSubmitGrading';
  } | {
    readonly type: 'quizRefresh';
  } | {
    readonly type: 'quizLoadFragmentTranslation';
  } | {
    readonly type: 'quizRcvdFragmentTranslation';
    readonly fragmentText: string;
    readonly translation: string;
  };

type ManifoldEffect =
  {
    readonly type: 'saveStateToStorage';
  } | {
    readonly type: 'quizSearchForTargetCtxFragments';
    readonly atomId: string;
  } | {
    readonly type: 'quizTranslateFragment';
    readonly fragmentText: string;
  };

type ManifoldDispatch = React.Dispatch<ManifoldEvent>;
type ManifoldExec = EffectReducerExec<ManifoldState, ManifoldEvent, ManifoldEffect>;

// There is a lot of shared work between finding the next due atom and computing core stats,
// so its all done here as "analysis".
interface AtomsAnalysis {
  readonly analysisTime: number; // unix time. to make timestamps consistent
  readonly dueAtoms: {
    readonly type: 'present';
    readonly atoms: ReadonlyArray<[string, Atom]>; // array of [atomId, atom]
  } | {
    readonly type: 'notYet';
    readonly timeUntilNextDue: number; // will be greater than zero
  } | {
    readonly type: 'noAtoms';
  };
}
function analyzeAtoms(atoms: ReadonlyMap<string, Atom>): AtomsAnalysis {
  // sort by ascending review time
  const sortedAtoms = [...atoms];
  sortedAtoms.sort(([, aAtom], [, bAtom]) => aAtom.rt - bAtom.rt);

  const curTime = getUnixTime();

  const dueAtoms: Array<[string, Atom]> = [];
  let timeUntilNextDue: number | undefined = undefined;
  for (const [aid, a] of sortedAtoms) {
    if (a.rt <= curTime) {
      dueAtoms.push([aid, a]);
      timeUntilNextDue = 0;
    } else {
      if (dueAtoms.length === 0) {
        timeUntilNextDue = a.rt - curTime;
      }
      break;
    }
  }

  // sanity checks
  if (dueAtoms.length > 0) {
    invariant(timeUntilNextDue === 0);
  } else {
    invariant((timeUntilNextDue === undefined) || (timeUntilNextDue > 0));
  }
  if (sortedAtoms.length > 0) {
    invariant(timeUntilNextDue !== undefined);
  } else {
    invariant(timeUntilNextDue === undefined);
    invariant(dueAtoms.length === 0)
  }

  return {
    analysisTime: curTime,
    dueAtoms: (timeUntilNextDue === undefined) ? {type: 'noAtoms'} : ((timeUntilNextDue > 0) ? {type: 'notYet', timeUntilNextDue} : {type: 'present', atoms: dueAtoms}),
  };
}

function updateStateToQuizTargetAtom(state: ManifoldState, atomId: string, exec: ManifoldExec): ManifoldState {
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
function updateStateToQuizNext(state: ManifoldState, exec: ManifoldExec): ManifoldState {
  const atomsAn = analyzeAtoms(state.atoms);

  // Are there any atoms due to review?
  if (atomsAn.dueAtoms.type === 'present') {
    // something due to review
    const [targetAtomId, ] = atomsAn.dueAtoms.atoms[0];

    return updateStateToQuizTargetAtom(state, targetAtomId, exec);
  } else {
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
        rt: atomsAn.analysisTime,
        iv: INITIAL_INTERVAL,
        nt: '',
        rm: false,
      }
      newAtoms.set(newAtomId, newAtom);

      return updateStateToQuizTargetAtom({
        ...state,
        atoms: newAtoms,
        queue: newQueue,
      }, newAtomId, exec);
    }
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
        return Math.floor(jitter(SUCCESS_MULT*oldInterval));
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
          return Math.floor(jitter(GRADUATING_INTERVAL));
        } else {
          return nextLearningIterval;
        }
      }

    case 'n':
      if (oldInterval > LAST_LEARNING_INTERVAL) {
        // was already graduated
        return Math.floor(jitter(Math.pow(oldInterval, FAIL_EXP)));
      } else {
        // was still in learning
        return INITIAL_INTERVAL;
      }

    default:
      throw new UnreachableCaseError(remembered);
  }
}

function updateStateCoreStats(state: ManifoldState): ManifoldState {
  const atomsAn = analyzeAtoms(state.atoms);

  return {
    ...state,
    atomsAn,
  };
}

function stateCanSubmitGrading(state: ManifoldState): boolean {
  invariant(state.mainUI.mode === 'quiz');
  invariant(state.mainUI.targetAtom !== null);

  return (state.mainUI.fragmentUnderstood !== null) && (state.mainUI.targetAtom.remembered !== null);
}

const reducer: EffectReducer<ManifoldState, ManifoldEvent, ManifoldEffect> = (state, event, exec) => {
  switch (event.type) {
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
        ss: state.addWordPanel.text.trim(),
        ta: getUnixTime(),
        fq: 0, // stubbed
      };

      const afterQueueState: ManifoldState = {
        ...state,
        queue: [...state.queue, newEntry],
        addWordPanel: {
          text: '',
        },
      };

      // the effect handler gets the final returned state, so OK to exec here
      exec({type: 'saveStateToStorage'});

      if (state.mainUI.mode === 'nothingToQuiz') {
        // this will "refresh" the quiz page if it is saying that nothing is due
        return updateStateCoreStats(updateStateToQuizNext(afterQueueState, exec));
      } else {
        return updateStateCoreStats(afterQueueState);
      }
    }

    case 'quizBegin':
      return updateStateCoreStats(updateStateToQuizNext(state, exec));

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
          fragmentTranslation: {type: 'none'},
          fragmentUnderstood: null,
          targetAtom: {
            fragmentHighlightedHTML: randomFragment.highlighted_html,
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

    case 'quizToggleTargetNotInFragment':
      invariant(state.mainUI.mode === 'quiz');
      invariant(state.mainUI.targetAtom !== null);

      return {
        ...state,
        mainUI: {
          ...state.mainUI,
          targetAtom: {
            ...state.mainUI.targetAtom,
            targetNotInFragment: !state.mainUI.targetAtom.targetNotInFragment,
          },
        },
      };

    case 'quizSubmitGrading': {
      invariant(state.mainUI.mode === 'quiz');
      invariant(state.mainUI.targetAtom !== null);
      invariant(state.mainUI.fragmentUnderstood !== null);
      const remembered = state.mainUI.targetAtom.remembered;
      invariant(remembered !== null);

      invariant(stateCanSubmitGrading(state)); // currently redundant with above, for type narrowing purposes

      const atomId = state.mainUI.targetAtom.atomId;
      const oldAtom = state.atoms.get(atomId);
      invariant(oldAtom);

      const newInterval = getNewInterval(remembered, oldAtom.iv);
      const newAtom: Atom = {
        ...oldAtom,
        iv: newInterval,
        rt: getUnixTime() + newInterval,
      };

      const newAtoms = new Map(state.atoms);
      newAtoms.set(atomId, newAtom);

      console.log('atom update:', {
        remembered,
        atomId,
        oldAtom,
        newAtom,
      });

      // the effect handler gets the final returned state, so OK to exec here
      exec({type: 'saveStateToStorage'});

      return updateStateCoreStats(updateStateToQuizNext({
        ...state,
        atoms: newAtoms,
      }, exec));
    }

    case 'quizRefresh':
      invariant(state.mainUI.mode === 'nothingToQuiz');
      return updateStateCoreStats(updateStateToQuizNext(state, exec));

    case 'quizLoadFragmentTranslation':
      invariant(state.mainUI.mode === 'quiz');

      exec({
        type: 'quizTranslateFragment',
        fragmentText: state.mainUI.fragmentText,
      });

      return {
        ...state,
        mainUI: {
          ...state.mainUI,
          fragmentTranslation: {
            type: 'loading',
          },
        },
      };

    case 'quizRcvdFragmentTranslation':
      // ignore event if it doesn't match current state
      if (state.mainUI.mode !== 'quiz') {
        return state;
      }
      if (event.fragmentText !== state.mainUI.fragmentText) {
        return state;
      }

      return {
        ...state,
        mainUI: {
          ...state.mainUI,
          fragmentTranslation: {
            type: 'loaded',
            translation: event.translation,
          },
        },
      };
  }
}

const effectsMap: EffectsMap<ManifoldState, ManifoldEvent, ManifoldEffect> = {
  saveStateToStorage: (state, effect, dispatch) => {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
      atoms: [...state.atoms.entries()],
      queue: state.queue,
    }));
  },

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

  quizTranslateFragment: (state, effect, dispatch) => {
    (async () => {
      let response: Response;
      try {
        response = await fetch(MASSIF_URL_API_TRANSLATE, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: effect.fragmentText,
          }),
        });
      } catch {
        console.error('quizTranslateFragment fetch failed');
        // TODO: dispatch event
        return;
      }

      if (!response.ok) {
        console.error('quizTranslateFragment bad status');
        // TODO: dispatch event
        return;
      }

      const result = await response.json();
      const translation = result.translation;
      invariant(translation);

      dispatch({
        type: 'quizRcvdFragmentTranslation',
        fragmentText: effect.fragmentText,
        translation,
      });
    })();
  },
};

const createInitialState: InitialEffectStateGetter<ManifoldState, ManifoldEvent, ManifoldEffect> = (exec) => {
  const storedStateStr = localStorage.getItem(LOCAL_STORAGE_KEY);
  const storedState = storedStateStr ? JSON.parse(storedStateStr) : null;
  // NOTE: We don't validate the shape of storedState

  return updateStateCoreStats({
    atoms: storedState ? new Map(storedState.atoms) : new Map(),
    queue: storedState ? storedState.queue : [],
    mainUI: {
      mode: 'overview',
    },
    addWordPanel: {
      text: '',
    },
    atomsAn: {
      analysisTime: getUnixTime(),
      dueAtoms: {
        type: 'noAtoms',
      }
    },
  });
}

// this may render to the opened panel or just the button
const AddWordPanel: React.FC<{localState: AddWordPanelState, dispatch: ManifoldDispatch}> = ({localState, dispatch}) => {
  const handleChangeWord = (event: React.ChangeEvent<HTMLInputElement>) => {
    dispatch({type: 'addWordPanelUpdateWord', text: event.target.value});
  };

  return (
    <div className="App-AddWordPanel">
      <input className="App-AddWordPanel-word" type="text" value={localState.text} onChange={handleChangeWord} />{' '}
      <button className="App-small-button" onClick={() => {dispatch({type: 'addWordPanelAdd'})}}>Add Word</button>
    </div>
  );
}

const StatusPanel: React.FC<{state: ManifoldState, dispatch: ManifoldDispatch}> = ({state, dispatch}) => {
  return (
    <div className="App-StatusPanel">
      <div className="App-StatusPanel-stats">
        <div>
          {(() => {
            const dueAtoms = state.atomsAn.dueAtoms;
            switch (dueAtoms.type) {
              case 'noAtoms':
                return null;

              case 'notYet':
                return <>{dueAtoms.timeUntilNextDue}s until due</>

              case 'present':
                return <>{dueAtoms.atoms.length} due now</>

              default:
                throw new UnreachableCaseError(dueAtoms);
            }
          })()}
        </div>
        <div>{state.queue.length} in queue</div>
      </div>
      <div className="App-StatusPanel-add-word">
        <AddWordPanel localState={state.addWordPanel} dispatch={dispatch} />
      </div>
    </div>
  );
}

const RadioButtons: React.FC<{label: string, options: ReadonlyArray<{val: string, name: string}>, val: string | null, onUpdate: (newKey: string) => void}> = ({label, options, val, onUpdate}) => {
  return (
    <div>
      <div>{label}</div>
      <div>
        {options.map(option => (
          <>
            <button
              key={option.val}
              onClick={() => {onUpdate(option.val)}}
              className={'App-chonky-button' + ((val === option.val) ? ' App-button-selected' : '')}
            >{option.name}</button>
            {' '}
          </>
        ))}
      </div>
    </div>
  );
}

const App: React.FC = () => {
  const [state, dispatch] = useEffectReducer(reducer, createInitialState, effectsMap);

  return (
    <div className="App">
      <StatusPanel state={state} dispatch={dispatch} />
      <div className="App-main-area">
        {(() => {
          switch (state.mainUI.mode) {
            case 'overview':
              return (
                <>
                  <button className="App-chonky-button" onClick={() => {dispatch({type: 'quizBegin'})}}>Study</button>
                </>
              );

            case 'quizLoadingTargetCtx':
              return (
                <>
                  loading context...
                </>
              );

            case 'quiz':
              return (
                <>
                  <div className="App-quiz-fragment-text">
                    {(state.mainUI.gradingRevealed && state.mainUI.targetAtom) ? (
                      <span dangerouslySetInnerHTML={{__html: state.mainUI.targetAtom.fragmentHighlightedHTML}}></span>
                    ) : (
                      <>{state.mainUI.fragmentText}</>
                    )}
                  </div>
                  {state.mainUI.gradingRevealed ? (
                    <div>
                      {state.mainUI.targetAtom ? (
                        <div className="App-quiz-space-above">
                          <div>Target</div>
                          <div className="App-quiz-target-text">{state.mainUI.targetAtom.searchString}</div>
                        </div>
                      ) : null}
                      <div className="App-quiz-space-above" style={{minHeight: '3em'}}>
                        <div>Translation (DeepL 🤖)</div>
                        <div>
                          {(() => {
                            const ft = state.mainUI.fragmentTranslation;
                            switch (ft.type) {
                              case 'none':
                                return <button className="App-small-button" onClick={() => {dispatch({type: 'quizLoadFragmentTranslation'})}}>Load</button>

                              case 'loading':
                                return <>Loading...</>

                              case 'loaded':
                                return <>{ft.translation}</>

                              default:
                                throw new UnreachableCaseError(ft);
                            }
                          })()}
                        </div>
                      </div>
                      <div className="App-quiz-space-above">
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
                      </div>
                      {state.mainUI.targetAtom ? (
                        <>
                          <div className="App-quiz-space-above">
                            <RadioButtons
                              label={'Target Remembered?'}
                              options={[
                                {val: 'y', name: 'Yes'},
                                {val: 'n', name: 'No'},
                              ]}
                              val={state.mainUI.targetAtom.remembered}
                              onUpdate={(newKey: string) => {dispatch({type: 'quizUpdateTargetAtomRemembered', val: newKey as AtomRemembered})}}
                            />
                          </div>
                          <div className="App-quiz-space-above">
                            <div>Other</div>
                            <div className="App-quiz-other-buttons">
                              <button
                                className={'App-chonky-button' + (state.mainUI.targetAtom.targetNotInFragment ? ' App-button-selected' : '')}
                                onClick={() => {dispatch({type: 'quizToggleTargetNotInFragment'})}}
                              >Target Not<br/>In Fragment</button>
                            </div>
                          </div>
                        </>
                      ) : null}
                      <div className="App-quiz-big-space-above">
                        <button className={'App-chonky-button' + (!stateCanSubmitGrading(state) ? ' App-hidden' : '')} onClick={() => {dispatch({type: 'quizSubmitGrading'})}}>Continue</button>
                      </div>
                    </div>
                  ) : (
                    <div className="App-quiz-big-space-above">
                      <button className="App-chonky-button" onClick={() => {dispatch({type: 'quizRevealGrading'})}}>Continue</button>
                    </div>
                  )}
                </>
              );

            case 'nothingToQuiz':
              return (
                <>
                  <div>Nothing due to review</div>
                  <div className="App-quiz-space-above"><button className="App-chonky-button" onClick={() => {dispatch({type: 'quizRefresh'})}}>Refresh</button></div>
                </>
              );

            default:
              throw new UnreachableCaseError(state.mainUI);
          }
        })()}
      </div>
    </div>
  );
}

export default App;
