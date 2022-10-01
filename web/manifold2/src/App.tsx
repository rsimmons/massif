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
      readonly fragmentUnderstood: boolean | undefined;
      readonly targetWordKnown: boolean | undefined;
      readonly targetWordProblemPanelShown: boolean;
      readonly targetWordNotInFragment: boolean;
    } | {
      readonly mode: 'nothingToQuiz';
    };
  readonly addWordPanel: AddWordPanelState;
  readonly stats: {
    readonly srsDueCount: number;
    readonly srsDueSoonCount: number;
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
    readonly type: 'quizTargetWordHasProblem';
  } | {
    readonly type: 'quizTargetWordIgnore';
  } | {
    readonly type: 'quizTargetToggleWordNotInFragment';
  } | {
    readonly type: 'quizTargetWordAgreeToSRS';
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

  const time = dayjs();
  const srsAn = getSRSAnalysis(state.qeState, time);

  return {
    ...state,
    stats: {
      srsDueCount: srsAn.dueWords.length,
      srsDueSoonCount: srsAn.dueSoonWords.length,
      srsTimeUntilNextLearningDue: (srsAn.dueSoonWords.length > 0) ? (srsAn.dueSoonWords[0].nextTime - time.unix()) : undefined,
      ...getSRSIntroStats(state.qeState),
      queuedCount: srsAn.queuedWords.length,
    }
  };
}

function quizCanSubmitGrading(state: ManifoldState): boolean {
  invariant(state.mainUI.mode === 'quiz');
  return (state.mainUI.fragmentUnderstood !== null) && (state.mainUI.targetWordKnown !== null);
}

function quizShouldAskAgreeToSRS(state: ManifoldState): boolean {
  invariant(state.mainUI.mode === 'quiz');

  return ((state.mainUI.quiz.kind === QuizKind.SUGGEST_SRS) || (state.mainUI.quiz.kind === QuizKind.SUGGEST_QUEUE)) && (state.mainUI.targetWordKnown === false);
}

// we take extra as a parameter because we don't store those fields as state,
// we submit as soon as they are chosen
function quizSubmitGrading(state: ManifoldState, extra: {targetWordIgnored: boolean, targetWordAgreedToSRS: boolean}, exec: EffectReducerExec<ManifoldState, ManifoldEvent, ManifoldEffect>): ManifoldState {
  invariant(state.mainUI.mode === 'quiz');
  invariant(state.mainUI.fragmentUnderstood !== undefined);
  invariant((state.mainUI.targetWordKnown !== undefined) || extra.targetWordIgnored);

  invariant(quizCanSubmitGrading(state)); // currently redundant with above, for type narrowing purposes

  const feedback: Feedback = {
    fragmentUnderstood: state.mainUI.fragmentUnderstood,
    targetWordKnown: state.mainUI.targetWordKnown,
    targetWordIgnored: extra.targetWordIgnored,
    targetWordAgreedToSRS: extra.targetWordAgreedToSRS,
    targetWordNotInFragment: state.mainUI.targetWordNotInFragment,
  };

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
          fragmentUnderstood: undefined,
          targetWordKnown: undefined,
          targetWordProblemPanelShown: false,
          targetWordNotInFragment: false,
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
      return quizShouldAskAgreeToSRS(newState) ?
        newState :
        quizSubmitGrading(newState, {targetWordIgnored: false, targetWordAgreedToSRS: false}, exec);
    }

    case 'quizTargetWordHasProblem':
      invariant(state.mainUI.mode === 'quiz');
      return {
        ...state,
        mainUI: {
          ...state.mainUI,
          targetWordProblemPanelShown: true,
        },
      };

    case 'quizTargetWordIgnore':
      invariant(state.mainUI.mode === 'quiz');

      return quizSubmitGrading(state, {targetWordIgnored: true, targetWordAgreedToSRS: false}, exec);

    case 'quizTargetToggleWordNotInFragment':
      invariant(state.mainUI.mode === 'quiz');
      return {
        ...state,
        mainUI: {
          ...state.mainUI,
          targetWordNotInFragment: !state.mainUI.targetWordNotInFragment,
        },
      };

    case 'quizTargetWordAgreeToSRS':
      invariant(state.mainUI.mode === 'quiz');

      return quizSubmitGrading(state, {targetWordIgnored: false, targetWordAgreedToSRS: true}, exec);

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
              return <>{state.stats.srsDueCount} due now{(state.stats.srsDueSoonCount > 0) && <>, {state.stats.srsDueSoonCount} due soon</> }</>
            } else if (state.stats.srsDueSoonCount > 0) {
              invariant(state.stats.srsTimeUntilNextLearningDue !== undefined);
              return <>{state.stats.srsDueSoonCount} due soon, {state.stats.srsTimeUntilNextLearningDue}s until next</>
            } else {
              return <>nothing for review today</>
            }
          })()}
        </div>
        <div>
          {state.stats.todayIntroCount}/{state.stats.todayIntroLimit} daily intros done
        </div>
        <div>
          {state.stats.queuedCount} in queue
        </div>
      </div>
      {/* <div className="App-StatusPanel-add-word">
        <AddWordPanel localState={state.addWordPanel} dispatch={dispatch} />
      </div> */}
    </div>
  );
}

const RadioButtons: React.FC<{options: ReadonlyArray<{val: string, name: string}>, val: string | null, onUpdate: (newKey: string) => void}> = ({options, val, onUpdate}) => {
  return (
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
  );
}

function maybeBoolToYN(v: boolean | undefined): 'y' | 'n' | null {
  if (v === undefined) {
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
                            <div className="App-quiz-section-label">🤖 Translation</div>
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
                            <div className="App-quiz-section-label">Read & Understood?</div>
                            <div style={{marginTop: '0.5em'}}>
                              <RadioButtons
                                options={[
                                  {val: 'y', name: 'Yes'},
                                  {val: 'n', name: 'No'},
                                ]}
                                val={maybeBoolToYN(state.mainUI.fragmentUnderstood)}
                                onUpdate={(newKey: string) => {dispatch({type: 'quizUpdateFragmentUnderstood', val: newKey === 'y'})}}
                              />
                            </div>
                          </div>
                          {(state.mainUI.fragmentUnderstood !== null) && (<>
                            <div className="App-quiz-space-above">
                              <div className="App-quiz-section-label">{(() => {
                                  switch (state.mainUI.quiz.kind) {
                                    case QuizKind.SRS_REVIEW:
                                      return 'Word Remembered?';

                                    case QuizKind.SUGGEST_SRS:
                                      return 'Word Known?';

                                    case QuizKind.SUGGEST_QUEUE:
                                      return 'Word Known?';

                                    default:
                                      throw new UnreachableCaseError(state.mainUI.quiz.kind);
                                  }
                              })()}</div>
                              <div className="App-quiz-target-word">{state.mainUI.quiz.targetWord.spec}</div>
                              <div>
                                <button className="App-small-button" onClick={() => {dispatch({type: 'quizTargetWordHasProblem'})}}>Problem?</button>
                              </div>
                              {state.mainUI.targetWordProblemPanelShown && (
                                <div style={{marginTop: '0.5em'}}>
                                  <button
                                    className="App-small-button"
                                    onClick={() => {dispatch({type: 'quizTargetWordIgnore'})}}
                                  >Ignore Word</button>{' '}
                                  <button
                                    className={'App-small-button' + (state.mainUI.targetWordNotInFragment ? ' App-button-selected' : '')}
                                    onClick={() => {dispatch({type: 'quizTargetToggleWordNotInFragment'})}}
                                  >Highlight Is Not This Word</button>
                                </div>
                              )}
                              <div style={{marginTop: '1em'}}>
                                <RadioButtons
                                  options={[
                                    {val: 'y', name: 'Yes'},
                                    {val: 'n', name: 'No'},
                                  ]}
                                  val={maybeBoolToYN(state.mainUI.targetWordKnown)}
                                  onUpdate={(newKey: string) => {dispatch({type: 'quizUpdateTargetWordKnown', val: newKey === 'y'})}}
                                />
                              </div>
                            </div>
                            {quizShouldAskAgreeToSRS(state) && (
                              <div className="App-quiz-space-above">
                                <div className="App-quiz-section-label">Learn Word? (SRS)</div>
                                {/* abusing radio buttons here, these submit immediately */}
                                <RadioButtons
                                  options={[
                                    {val: 'agree', name: 'Yes'},
                                    {val: 'ignore', name: 'No (Ignore)'},
                                  ]}
                                  val={null}
                                  onUpdate={(newKey: string) => {
                                    if (newKey === 'agree') {
                                      dispatch({type: 'quizTargetWordAgreeToSRS'});
                                    } else if (newKey === 'ignore') {
                                      dispatch({type: 'quizTargetWordIgnore'});
                                    } else {
                                      invariant(false);
                                    }
                                  }}
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
