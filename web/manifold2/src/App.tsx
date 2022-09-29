import React, { useState } from 'react';
import { useEffectReducer, EffectReducer, EffectsMap, InitialEffectStateGetter, EffectReducerExec } from "use-effect-reducer";
import dayjs from 'dayjs';

import { invariant, UnreachableCaseError } from './util';
import { getSRSAnalysis, Feedback, getNextQuiz, getPlacementTest, initState, needPlacementTest, PlacementTest, Quiz, QuizEngineState, QuizKind, setOrderingIntroIdx, takeFeedback, SRSAnalysis, getSRSIntroStats } from './quizEngine';
import './App.css';
import { translateText } from './massifAPI';

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
      readonly mode: 'placementTest';
      readonly test: PlacementTest;
    } | {
      readonly mode: 'quizLoading';
    } | {
      readonly mode: 'quiz';
      readonly quiz: Quiz;
      readonly gradingRevealed: boolean;
      readonly fragmentTranslation: FragmentTranslation;
      readonly fragmentUnderstood: null | boolean;
      readonly targetWordKnown: null | boolean;
      readonly addOrQueueTargetWordToSRS: null | boolean;
    } | {
      readonly mode: 'nothingToQuiz';
    };
  readonly addWordPanel: AddWordPanelState;
  readonly stats: {
    readonly srsDueCount: number;
    readonly srsTimeUntilNextLearningDue: number | undefined;
    readonly todayIntroCount: number;
    readonly todayIntroLimit: number;
    readonly queuedCount: number;
  } | undefined;
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
    readonly type: 'beginStudying';
  } | {
    readonly type: 'placementTestRepickWords';
  } | {
    readonly type: 'placementTestSetIndex';
    readonly index: number;
  } | {
    readonly type: 'quizLoaded';
    readonly quiz: Quiz;
  } | {
    readonly type: 'quizRevealGrading';
  } | {
    readonly type: 'quizUpdateFragmentUnderstood';
    readonly val: boolean;
  } | {
    readonly type: 'quizUpdateTargetWordKnown';
    readonly val: boolean;
  } | {
    readonly type: 'quizUpdateAddTargetWordToSRS';
    readonly val: boolean;
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

function loadNextQuiz(state: ManifoldState, exec: ManifoldExec): ManifoldState {
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

function updateStats(state: ManifoldState): ManifoldState {
  invariant(state.qeState);

  const srsAn = getSRSAnalysis(state.qeState, dayjs());

  return {
    ...state,
    stats: {
      srsDueCount: srsAn.dueWords.length,
      srsTimeUntilNextLearningDue: srsAn.timeUntilNextLearning,
      ...getSRSIntroStats(state.qeState),
      queuedCount: srsAn.queuedWords.length,
    }
  };
}

function quizCanSubmitGrading(state: ManifoldState): boolean {
  invariant(state.mainUI.mode === 'quiz');
  return (state.mainUI.fragmentUnderstood !== null) && (state.mainUI.targetWordKnown !== null);
}

function quizShouldAskAboutAddingOrQueueing(state: ManifoldState): boolean {
  invariant(state.mainUI.mode === 'quiz');

  return ((state.mainUI.quiz.kind === QuizKind.SUGGEST_SRS) || (state.mainUI.quiz.kind === QuizKind.SUGGEST_QUEUE)) && (state.mainUI.targetWordKnown === false);
}

function quizSubmitGrading(state: ManifoldState, exec: EffectReducerExec<ManifoldState, ManifoldEvent, ManifoldEffect>): ManifoldState {
  invariant(state.mainUI.mode === 'quiz');
  invariant(state.mainUI.fragmentUnderstood !== null);
  invariant(state.mainUI.targetWordKnown !== null);

  invariant(quizCanSubmitGrading(state)); // currently redundant with above, for type narrowing purposes

  const feedback: Feedback = (() => {
    if (state.mainUI.fragmentUnderstood) {
      invariant(state.mainUI.targetWordKnown);
      return {kind: 'Fy'};
    } else {
      if (state.mainUI.targetWordKnown) {
        return {kind: 'FnWy'};
      } else {
        switch (state.mainUI.addOrQueueTargetWordToSRS) {
          case null:
            return {kind: 'FnWn'};

          case true:
            return {kind: 'FnWnAy'};

          case false:
            return {kind: 'FnWnAn'};
        }
      }
    }
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

// Expose the quiz engine state as a global variable for messing around in the console
declare global {
  var quizEngineState: QuizEngineState;
}

const reducer: EffectReducer<ManifoldState, ManifoldEvent, ManifoldEffect> = (state, event, exec) => {
  switch (event.type) {
    case 'profileLoaded':
      globalThis.quizEngineState = event.qeState;

      return updateStats({
        ...state,
        mainUI: {
          mode: 'home',
        },
        qeState: event.qeState,
      });

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
        return updateStats(loadNextQuiz(afterQueueState, exec));
      } else {
        return updateStats(afterQueueState);
      }
      */
     return state;
    }

    case 'beginStudying': {
      invariant(state.qeState);
      if (needPlacementTest(state.qeState)) {
        const test = getPlacementTest();
        return {
          ...state,
          mainUI: {
            mode: 'placementTest',
            test,
          },
        };
      } else {
        return loadNextQuiz(state, exec);
      }
    }

    case 'placementTestRepickWords': {
      invariant(state.qeState);
      invariant(needPlacementTest(state.qeState));
      const test = getPlacementTest();
      return {
        ...state,
        mainUI: {
          mode: 'placementTest',
          test,
        },
      };
    }

    case 'placementTestSetIndex': {
      invariant(state.qeState);

      // this is a side-effect, but I believe it's OK to not use an effect
      // because it's idempotent
      setOrderingIntroIdx(state.qeState, event.index);

      return loadNextQuiz(state, exec);
    }

    case 'quizLoaded': {
      return updateStats({
        ...state,
        mainUI: {
          mode: 'quiz',
          quiz: event.quiz,
          gradingRevealed: false,
          fragmentTranslation: {type: 'none'},
          fragmentUnderstood: null,
          targetWordKnown: null,
          addOrQueueTargetWordToSRS: null,
        },
      });
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

    case 'quizUpdateTargetWordKnown': {
      invariant(state.mainUI.mode === 'quiz');

      const newState: ManifoldState = {
        ...state,
        mainUI: {
          ...state.mainUI,
          targetWordKnown: event.val,
        },
      };

      // If we will suggest SRS, return this state,
      // otherwise go ahead and submit grading (we're done with quiz)
      return quizShouldAskAboutAddingOrQueueing(newState) ?
        newState :
        quizSubmitGrading(newState, exec);
    }

    case 'quizUpdateAddTargetWordToSRS': {
      invariant(state.mainUI.mode === 'quiz');

      const newState: ManifoldState = {
        ...state,
        mainUI: {
          ...state.mainUI,
          addOrQueueTargetWordToSRS: event.val,
        },
      };

      return quizSubmitGrading(newState, exec);
    }

    case 'quizSubmitGrading':
      return quizSubmitGrading(state, exec);

    case 'quizRefresh':
      invariant(state.mainUI.mode === 'nothingToQuiz');
      return loadNextQuiz(state, exec);

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

  return {
    qeState: undefined,
    mainUI: {
      mode: 'loading',
    },
    addWordPanel: {
      text: '',
    },
    stats: undefined,
  };
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
  invariant(state.stats);

  return (
    <div className="App-StatusPanel">
      <div className="App-StatusPanel-stats">
        <div>
          {(() => {
            if (state.stats.srsDueCount > 0) {
              return <>{state.stats.srsDueCount} due now</>
            } else if (state.stats.srsTimeUntilNextLearningDue !== undefined) {
              return <>{state.stats.srsTimeUntilNextLearningDue}s until due</>
            } else {
              return <>nothing due for review</>
            }
          })()}
        </div>
        <div>
          {state.stats.todayIntroCount}/{state.stats.todayIntroLimit} daily intros done
        </div>
        <div>
          {state.stats.queuedCount} words in queue
        </div>
      </div>
      {/* <div className="App-StatusPanel-add-word">
        <AddWordPanel localState={state.addWordPanel} dispatch={dispatch} />
      </div> */}
    </div>
  );
}

const RadioButtons: React.FC<{label: string, belowLabel?: string, options: ReadonlyArray<{val: string, name: string}>, val: string | null, onUpdate: (newKey: string) => void}> = ({label, belowLabel, options, val, onUpdate}) => {
  return (
    <div>
      <div>{label}</div>
      {belowLabel && (
        <div className="RadioButtons-below-label">{belowLabel}</div>
      )}
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

function maybeBoolToYN(v: boolean | null): 'y' | 'n' | null {
  if (v === null) {
    return null;
  } else {
    return v ? 'y' : 'n';
  }
}

const PlacementTestPanel: React.FC<{test: PlacementTest, dispatch: ManifoldDispatch}> = ({test, dispatch}) => {
  const [selGroup, setSetGroup] = useState<number | null>(null);

  return (
    <div className="App-placement-test">
      <div>
        <strong>Choose a level to start learning from</strong><br/>
        Manifold uses an ordered list of words to prioritize what it teaches you. Shown below are random sets of words, each drawn from a different range of that ordering. We recommend choosing the <em>highest level where there are more than 1 or 2 words you don't know</em>. This is the level at which around which Manifold will start suggesting words for you to study. And don't worry: 1) you can change this setting later 2) you can easily skip studying any words you already know 3) if there are words below that level you don't know, you will have a chance to fill in those gaps as well.<br />
        <strong>Note:</strong> Words are currently shown in their most kanji-ified forms, which makes easy words hard to recognize (e.g. この is shown as 此の, する is shown as 為る). This will be fixed soon.
      </div>
      <div><button onClick={() => {dispatch({type: 'placementTestRepickWords'})}}>Repick Words</button></div>
      {test.map((group, gidx) => (
        <div key={gidx} className="App-placement-test-group">
          <input type="radio" name="placement-test-group" id={`placement-test-group-${gidx}`} checked={gidx === selGroup} onChange={() => {console.log('chose placement group', group); setSetGroup(gidx)}} />
          <label htmlFor={`placement-test-group-${gidx}`}>
            <span className="App-placement-test-group-level">[Level {gidx+1}]</span> {group.words.map((word, widx) => <span key={widx} className="App-placement-test-words">{word}</span>)}
          </label>
        </div>
      ))}
      <div><button className="App-chonky-button" disabled={selGroup === null} onClick={() => {dispatch({type: 'placementTestSetIndex', index: test[selGroup!].beginIndex})}}>Set Level</button></div>
    </div>
  );
}

const App: React.FC = () => {
  const [state, dispatch] = useEffectReducer(reducer, createInitialState, effectsMap);

  return (
    <div className="App">
      {(() => {
        if (state.mainUI.mode === 'loading') {
          return <div>loading...</div>;
        }

        invariant(state.qeState);

        return (<>
          {!needPlacementTest(state.qeState) &&
            <StatusPanel state={state} dispatch={dispatch} />
          }
          <div className="App-main-area">
            {(() => {
              switch (state.mainUI.mode) {
                case 'home':
                  return (
                    <>
                      <button className="App-chonky-button" onClick={() => {dispatch({type: 'beginStudying'})}}>Study</button>
                    </>
                  );

                case 'placementTest':
                  return <PlacementTestPanel test={state.mainUI.test} dispatch={dispatch} />

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
                        {(state.mainUI.gradingRevealed && (state.mainUI.fragmentUnderstood !== null)) ? (
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
                              label={'Read+understood?'}
                              options={[
                                {val: 'y', name: 'Yes'},
                                {val: 'n', name: 'No'},
                              ]}
                              val={maybeBoolToYN(state.mainUI.fragmentUnderstood)}
                              onUpdate={(newKey: string) => {dispatch({type: 'quizUpdateFragmentUnderstood', val: newKey === 'y'})}}
                            />
                          </div>
                          {(state.mainUI.fragmentUnderstood !== null) && (<>
                            <div className="App-quiz-space-above">
                              <RadioButtons
                                label={'Word known?'}
                                belowLabel={state.mainUI.quiz.targetWord.spec} // such a hack
                                options={[
                                  {val: 'y', name: 'Yes'},
                                  {val: 'n', name: 'No'},
                                ]}
                                val={maybeBoolToYN(state.mainUI.targetWordKnown)}
                                onUpdate={(newKey: string) => {dispatch({type: 'quizUpdateTargetWordKnown', val: newKey === 'y'})}}
                              />
                            </div>
                            {quizShouldAskAboutAddingOrQueueing(state) && (
                              <div className="App-quiz-space-above">
                                <RadioButtons
                                  label={(() => {
                                    switch (state.mainUI.quiz.kind) {
                                      case QuizKind.SUGGEST_SRS:
                                        return 'Add to SRS?';

                                      case QuizKind.SUGGEST_QUEUE:
                                        return 'Queue for SRS?';

                                      default:
                                        invariant(false);
                                    }
                                  })()}
                                  options={[
                                    {val: 'y', name: 'Yes'},
                                    {val: 'n', name: 'No'},
                                  ]}
                                  val={maybeBoolToYN(state.mainUI.addOrQueueTargetWordToSRS)}
                                  onUpdate={(newKey: string) => {dispatch({type: 'quizUpdateAddTargetWordToSRS', val: newKey === 'y'})}}
                                />
                              </div>
                            )}
                          </>)}
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
        </>);
      })()}
    </div>
  );
}

export default App;
