import React from 'react';
import { useEffectReducer, EffectReducer, EffectsMap, InitialEffectStateGetter, EffectReducerExec } from "use-effect-reducer";
import dayjs from 'dayjs';

import { invariant, UnreachableCaseError } from './util';
import { Feedback, getNextQuiz, initState, Quiz, QuizEngineState, QuizKind, takeFeedback } from './quizEngine';
import './App.css';
import { translateText } from './massifAPI';


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
  // Quiz engine state
  readonly qeState: QuizEngineState | undefined;

  // Unsaved state (UI, derived state)
  readonly mainUI:
    {
      readonly mode: 'loading';
    } | {
      readonly mode: 'home';
    } | {
      readonly mode: 'quizLoading';
    } | {
      readonly mode: 'quiz';
      readonly quiz: Quiz;
      readonly gradingRevealed: boolean;
      readonly fragmentTranslation: FragmentTranslation;
      readonly fragmentUnderstood: null | FragmentUnderstood;
      readonly atomRemembered: null | AtomRemembered;
      readonly targetNotInFragment: boolean;
    } | {
      readonly mode: 'nothingToQuiz';
    };
  readonly addWordPanel: AddWordPanelState;
  // readonly atomsAn: AtomsAnalysis; // used for stats display
}

type ManifoldEvent =
  {
    readonly type: 'profileLoaded';
    readonly qeState: QuizEngineState;
  } | {
    readonly type: 'addWordPanelUpdateWord';
    readonly text: string;
  } | {
    readonly type: 'addWordPanelAdd';
  } | {
    readonly type: 'quizBegin';
  } | {
    readonly type: 'quizLoaded';
    readonly quiz: Quiz;
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
    readonly type: 'profileLoad';
  } | {
    readonly type: 'quizLoad';
  } | {
    readonly type: 'quizTakeFeedbackAndLoadNext',
    readonly prevQuiz: Quiz;
    readonly feedback: Feedback;
  } | {
    readonly type: 'quizTranslateFragment';
    readonly fragmentText: string;
  };

type ManifoldDispatch = React.Dispatch<ManifoldEvent>;
type ManifoldExec = EffectReducerExec<ManifoldState, ManifoldEvent, ManifoldEffect>;

function updateStateToQuizNext(state: ManifoldState, exec: ManifoldExec): ManifoldState {
  exec({
    type: 'quizLoad',
  });

  return {
    ...state,
    mainUI: {
      mode: 'quizLoading',
    },
  };
}

function updateStateCoreStats(state: ManifoldState): ManifoldState {
  return state;
  /*
  const atomsAn = analyzeAtoms(state.atoms);

  return {
    ...state,
    atomsAn,
  };
  */
}

function stateCanSubmitGrading(state: ManifoldState): boolean {
  invariant(state.mainUI.mode === 'quiz');
  return (state.mainUI.fragmentUnderstood !== null) && (state.mainUI.atomRemembered !== null);
}

const reducer: EffectReducer<ManifoldState, ManifoldEvent, ManifoldEffect> = (state, event, exec) => {
  switch (event.type) {
    case 'profileLoaded':
      return {
        ...state,
        mainUI: {
          mode: 'home',
        },
        qeState: event.qeState,
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

      /*
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
      */
     return state;
    }

    case 'quizBegin':
      return updateStateCoreStats(updateStateToQuizNext(state, exec));

    case 'quizLoaded': {
      return {
        ...state,
        mainUI: {
          mode: 'quiz',
          quiz: event.quiz,
          gradingRevealed: false,
          fragmentTranslation: {type: 'none'},
          fragmentUnderstood: null,
          atomRemembered: null,
          targetNotInFragment: false,
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

      return {
        ...state,
        mainUI: {
          ...state.mainUI,
          atomRemembered: event.val,
        },
      };

    case 'quizToggleTargetNotInFragment':
      invariant(state.mainUI.mode === 'quiz');

      return {
        ...state,
        mainUI: {
          ...state.mainUI,
          targetNotInFragment: !state.mainUI.targetNotInFragment,
        },
      };

    case 'quizSubmitGrading': {
      invariant(state.mainUI.mode === 'quiz');
      invariant(state.mainUI.fragmentUnderstood !== null);
      invariant(state.mainUI.fragmentUnderstood !== 'u'); // don't support this now
      invariant(state.mainUI.atomRemembered !== null);

      invariant(stateCanSubmitGrading(state)); // currently redundant with above, for type narrowing purposes

      const feedback: Feedback = (() => {
        console.log('quizSubmitGrading', state.mainUI);
        if (state.mainUI.fragmentUnderstood === 'y') {
          invariant(state.mainUI.atomRemembered === 'y');
          return {kind: 'Fy'};
        } else {
          return (state.mainUI.atomRemembered === 'y') ? {kind: 'FnWy'} : {kind: 'FnWn'};
        }

        invariant(false);
      })();

      exec({
        type: 'quizTakeFeedbackAndLoadNext',
        prevQuiz: state.mainUI.quiz,
        feedback,
      });

      return {
        ...state,
        mainUI: {
          mode: 'quizLoading',
        },
      };
    }

    case 'quizRefresh':
      invariant(state.mainUI.mode === 'nothingToQuiz');
      return updateStateCoreStats(updateStateToQuizNext(state, exec));

    case 'quizLoadFragmentTranslation':
      invariant(state.mainUI.mode === 'quiz');

      exec({
        type: 'quizTranslateFragment',
        fragmentText: state.mainUI.quiz.fragmentText,
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
      if (event.fragmentText !== state.mainUI.quiz.fragmentText) {
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
  profileLoad: (state, effect, dispatch) => {
    (async () => {
      const qeState = await initState({}, dayjs());

      dispatch({
        type: 'profileLoaded',
        qeState,
      });
    })();
  },

  quizLoad: (state, effect, dispatch) => {
    (async () => {
      invariant(state.qeState);

      const quiz = await getNextQuiz(state.qeState, dayjs());

      dispatch({
        type: 'quizLoaded',
        quiz,
      });
    })();
  },

  quizTakeFeedbackAndLoadNext: (state, effect, dispatch) => {
    (async () => {
      invariant(state.qeState);

      const t = dayjs();
      await takeFeedback(state.qeState, t, effect.prevQuiz, effect.feedback);
      const quiz = await getNextQuiz(state.qeState, t);

      dispatch({
        type: 'quizLoaded',
        quiz,
      });
    })();
  },

  quizTranslateFragment: (state, effect, dispatch) => {
    (async () => {
      const translation = await translateText(effect.fragmentText);

      dispatch({
        type: 'quizRcvdFragmentTranslation',
        fragmentText: effect.fragmentText,
        translation,
      });
    })();
  },
};

const createInitialState: InitialEffectStateGetter<ManifoldState, ManifoldEvent, ManifoldEffect> = (exec) => {
  exec({type: 'profileLoad'});

  return updateStateCoreStats({
    qeState: undefined,
    mainUI: {
      mode: 'loading',
    },
    addWordPanel: {
      text: '',
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

/*
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
*/

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
      {state.mainUI.mode === 'loading' ? (
        <div>loading...</div>
      ) : (<>
        {/* <StatusPanel state={state} dispatch={dispatch} /> */}
        <div className="App-main-area">
          {(() => {
            switch (state.mainUI.mode) {
              case 'home':
                return (
                  <>
                    <button className="App-chonky-button" onClick={() => {dispatch({type: 'quizBegin'})}}>Study</button>
                  </>
                );

              case 'quizLoading':
                return (
                  <>
                    loading...
                  </>
                );

              case 'quiz':
                return (
                  <>
                    <div className="App-quiz-fragment-text">
                      {(state.mainUI.gradingRevealed) ? (
                        <span dangerouslySetInnerHTML={{__html: state.mainUI.quiz.fragmentHighlightedHTML}}></span>
                      ) : (
                        <>{state.mainUI.quiz.fragmentText}</>
                      )}
                    </div>
                    {state.mainUI.gradingRevealed ? (
                      <div>
                        {/* <div className="App-quiz-space-above">
                          <div>Target</div>
                          <div className="App-quiz-target-text">{state.mainUI.targetAtom.searchString}</div>
                        </div> */}
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
                        <div className="App-quiz-space-above">
                          <RadioButtons
                            label={'Target Remembered?'}
                            options={[
                              {val: 'y', name: 'Yes'},
                              {val: 'n', name: 'No'},
                            ]}
                            val={state.mainUI.atomRemembered}
                            onUpdate={(newKey: string) => {dispatch({type: 'quizUpdateTargetAtomRemembered', val: newKey as AtomRemembered})}}
                          />
                        </div>
                        <div className="App-quiz-space-above">
                          <div>Other</div>
                          <div className="App-quiz-other-buttons">
                            <button
                              className={'App-chonky-button' + (state.mainUI.targetNotInFragment ? ' App-button-selected' : '')}
                              onClick={() => {dispatch({type: 'quizToggleTargetNotInFragment'})}}
                            >Target Not<br/>In Fragment</button>
                          </div>
                        </div>
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
      </>)}
    </div>
  );
}

export default App;
