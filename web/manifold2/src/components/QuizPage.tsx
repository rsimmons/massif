import { useEffectReducer, EffectReducer, EffectsMap, EffectReducerExec, InitialEffectStateGetter } from 'use-effect-reducer';
import { useNavigate } from 'react-router-dom';
import dayjs, { Dayjs } from 'dayjs';

import { invariant, UnreachableCaseError } from '../util';
import { Feedback, getNextQuiz, getSRSAnalysis, needPlacementTest, Quiz, QuizEngineState, QuizKind, SRSAnalysis, takeFeedback } from '../quizEngine';
import { translateText } from '../massifAPI';
import Header from './Header';
import './QuizPage.css';

type FragmentTranslation =
  {
    type: 'none';
  } | {
    type: 'loading';
  } | {
    type: 'loaded';
    translation: string;
  };

type QuizPageState =
  {
    type: 'loading';
    readonly qeState: QuizEngineState;
    readonly srsAn: SRSAnalysis;
  } | {
    type: 'quiz';
    readonly qeState: QuizEngineState;
    readonly srsAn: SRSAnalysis;
    readonly quiz: Quiz;
    readonly gradingRevealed: boolean;
    readonly fragmentTranslation: FragmentTranslation;
    readonly fragmentUnderstood: boolean | undefined;
    readonly targetWordKnown: boolean | undefined;
    readonly targetWordProblemPanelShown: boolean;
    readonly targetWordNotInFragment: boolean;
  };

type QuizPageEvent =
  {
    readonly type: 'quizLoaded';
    readonly quiz: Quiz;
    readonly srsAn: SRSAnalysis;
  } | {
    readonly type: 'revealGrading';
  } | {
    readonly type: 'updateFragmentUnderstood';
    readonly val: boolean;
  } | {
    readonly type: 'updateTargetWordKnown';
    readonly val: boolean;
  } | {
    readonly type: 'targetWordHasProblem';
  } | {
    readonly type: 'targetWordIgnore';
  } | {
    readonly type: 'targetToggleWordNotInFragment';
  } | {
    readonly type: 'targetWordAgreeToSRS';
  } | {
    readonly type: 'loadFragmentTranslation';
  } | {
    readonly type: 'rcvdFragmentTranslation';
    readonly fragmentText: string;
    readonly translation: string;
  };

type QuizPageEffect =
  {
    readonly type: 'loadQuiz';
  } | {
    readonly type: 'takeFeedbackAndLoadNext',
    readonly prevQuiz: Quiz;
    readonly feedback: Feedback;
  } | {
    readonly type: 'translateFragment';
    readonly fragmentText: string;
  };

type QuizPageDispatch = React.Dispatch<QuizPageEvent>;
type ManifoldExec = EffectReducerExec<QuizPageState, QuizPageEvent, QuizPageEffect>;

function canSubmitGrading(state: QuizPageState): boolean {
  invariant(state.type === 'quiz');
  return (state.fragmentUnderstood !== null) && (state.targetWordKnown !== null);
}

function shouldAskAgreeToSRS(state: QuizPageState): boolean {
  invariant(state.type === 'quiz');

  return ((state.quiz.kind === QuizKind.SUGGEST_SRS) || (state.quiz.kind === QuizKind.SUGGEST_QUEUE)) && (state.targetWordKnown === false);
}

// we take extra as a parameter because we don't store those fields as state,
// we submit as soon as they are chosen
function submitGrading(state: QuizPageState, extra: {targetWordIgnored: boolean, targetWordAgreedToSRS: boolean}, exec: EffectReducerExec<QuizPageState, QuizPageEvent, QuizPageEffect>): QuizPageState {
  invariant(state.type === 'quiz');
  invariant(state.fragmentUnderstood !== undefined);
  invariant((state.targetWordKnown !== undefined) || extra.targetWordIgnored);

  invariant(canSubmitGrading(state)); // currently redundant with above, for type narrowing purposes

  const feedback: Feedback = {
    fragmentUnderstood: state.fragmentUnderstood,
    targetWordKnown: state.targetWordKnown,
    targetWordIgnored: extra.targetWordIgnored,
    targetWordAgreedToSRS: extra.targetWordAgreedToSRS,
    targetWordNotInFragment: state.targetWordNotInFragment,
  };

  exec({
    type: 'takeFeedbackAndLoadNext',
    prevQuiz: state.quiz,
    feedback,
  });

  return {
    type: 'loading',
    qeState: state.qeState,
    srsAn: state.srsAn,
  };
}

const reducer: EffectReducer<QuizPageState, QuizPageEvent, QuizPageEffect> = (state, event, exec) => {
  switch (event.type) {
    case 'quizLoaded':
      return {
        type: 'quiz',
        qeState: state.qeState,
        srsAn: event.srsAn,
        quiz: event.quiz,
        gradingRevealed: false,
        fragmentTranslation: {type: 'none'},
        fragmentUnderstood: undefined,
        targetWordKnown: undefined,
        targetWordProblemPanelShown: false,
        targetWordNotInFragment: false,
      };

    case 'revealGrading':
      invariant(state.type === 'quiz');

      return {
        ...state,
        gradingRevealed: true,
      };

    case 'updateFragmentUnderstood':
      invariant(state.type === 'quiz');

      return {
        ...state,
        fragmentUnderstood: event.val,
      };

    case 'updateTargetWordKnown': {
      invariant(state.type === 'quiz');

      const newState: QuizPageState = {
        ...state,
        targetWordKnown: event.val,
      };

      // If we will suggest SRS, return this state,
      // otherwise go ahead and submit grading (we're done with quiz)
      return shouldAskAgreeToSRS(newState) ?
        newState :
        submitGrading(newState, {targetWordIgnored: false, targetWordAgreedToSRS: false}, exec);
    }

    case 'targetWordHasProblem':
      invariant(state.type === 'quiz');
      return {
        ...state,
        targetWordProblemPanelShown: true,
      };

    case 'targetWordIgnore':
      invariant(state.type === 'quiz');

      return submitGrading(state, {targetWordIgnored: true, targetWordAgreedToSRS: false}, exec);

    case 'targetToggleWordNotInFragment':
      invariant(state.type === 'quiz');
      return {
        ...state,
        targetWordNotInFragment: !state.targetWordNotInFragment,
      };

    case 'targetWordAgreeToSRS':
      invariant(state.type === 'quiz');

      return submitGrading(state, {targetWordIgnored: false, targetWordAgreedToSRS: true}, exec);

    case 'loadFragmentTranslation':
      invariant(state.type === 'quiz');

      exec({
        type: 'translateFragment',
        fragmentText: state.quiz.fragmentText,
      });

      return {
        ...state,
        fragmentTranslation: {
          type: 'loading',
        },
      };

    case 'rcvdFragmentTranslation':
      // ignore event if it doesn't match current state
      if (state.type !== 'quiz') {
        return state;
      }
      if (event.fragmentText !== state.quiz.fragmentText) {
        return state;
      }

      return {
        ...state,
        fragmentTranslation: {
          type: 'loaded',
          translation: event.translation,
        },
      };
  }
}

const effectsMap: EffectsMap<QuizPageState, QuizPageEvent, QuizPageEffect> = {
  loadQuiz: (state, effect, dispatch) => {
    (async () => {
      invariant(state.qeState);

      const t = dayjs();
      const [quiz, srsAn] = await getNextQuiz(state.qeState, t);

      dispatch({
        type: 'quizLoaded',
        quiz,
        srsAn,
      });
    })();
  },

  takeFeedbackAndLoadNext: (state, effect, dispatch) => {
    (async () => {
      invariant(state.qeState);

      const t = dayjs();
      await takeFeedback(state.qeState, t, effect.prevQuiz, effect.feedback);
      const [quiz, srsAn] = await getNextQuiz(state.qeState, t);

      dispatch({
        type: 'quizLoaded',
        quiz,
        srsAn,
      });
    })();
  },

  translateFragment: (state, effect, dispatch) => {
    (async () => {
      const translation = await translateText(effect.fragmentText);

      dispatch({
        type: 'rcvdFragmentTranslation',
        fragmentText: effect.fragmentText,
        translation,
      });
    })();
  },
};

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

const QuizPage: React.FC<{quizEngineState: QuizEngineState}> = ({quizEngineState}) => {
  const navigate = useNavigate();

  const getInitialState: InitialEffectStateGetter<QuizPageState, QuizPageEvent, QuizPageEffect> = exec => {
    // start loading quiz unless we are about to redirect to placement
    if (!needPlacementTest(quizEngineState)) {
      exec({type: 'loadQuiz'});
    }

    return {
      type: 'loading',
      qeState: quizEngineState,
      srsAn: getSRSAnalysis(quizEngineState, dayjs()),
    };
  };

  if (needPlacementTest(quizEngineState)) {
    navigate('/placement');
  }

  const [state, dispatch] = useEffectReducer(reducer, getInitialState, effectsMap);

  invariant(state.qeState === quizEngineState, 'QuizPage: quizEngineState param cannot change');

  return (
    <>
      <Header srsAn={state.srsAn} />
      <div className="QuizPage-main">
        {(() => {
          switch (state.type) {
            case 'loading':
              return (
                <>
                  loading...
                </>
              );

            case 'quiz':
              return (
                <>
                  <div className="QuizPage-fragment-text">
                    {(state.gradingRevealed && (state.fragmentUnderstood !== undefined)) ? (
                      <span dangerouslySetInnerHTML={{__html: state.quiz.fragmentHighlightedHTML}}></span>
                    ) : (
                      <>{state.quiz.fragmentText}</>
                    )}
                  </div>
                  {state.gradingRevealed ? (
                    <div>
                      <div className="QuizPage-space-above" style={{minHeight: '3em'}}>
                        <div className="QuizPage-section-label">🤖 Translation</div>
                        <div>
                          {(() => {
                            const ft = state.fragmentTranslation;
                            switch (ft.type) {
                              case 'none':
                                return <button className="App-small-button" onClick={() => {dispatch({type: 'loadFragmentTranslation'})}}>Load</button>

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
                      <div className="QuizPage-space-above">
                        <div className="QuizPage-section-label">Read &amp; Understood?</div>
                        <div style={{marginTop: '0.5em'}}>
                          <RadioButtons
                            options={[
                              {val: 'y', name: 'Yes'},
                              {val: 'n', name: 'No'},
                            ]}
                            val={maybeBoolToYN(state.fragmentUnderstood)}
                            onUpdate={(newKey: string) => {dispatch({type: 'updateFragmentUnderstood', val: newKey === 'y'})}}
                          />
                        </div>
                      </div>
                      {(state.fragmentUnderstood !== undefined) && (<>
                        <div className="QuizPage-space-above">
                          <div className="QuizPage-section-label">{(() => {
                              switch (state.quiz.kind) {
                                case QuizKind.SRS_REVIEW:
                                  return 'Word Remembered?';

                                case QuizKind.SUGGEST_SRS:
                                  return 'Word Known?';

                                case QuizKind.SUGGEST_QUEUE:
                                  return 'Word Known?';

                                default:
                                  throw new UnreachableCaseError(state.quiz.kind);
                              }
                          })()}</div>
                          <div className="QuizPage-target-word">{state.quiz.targetWord.spec}</div>
                          <div>
                            <button className="App-small-button" onClick={() => {dispatch({type: 'targetWordHasProblem'})}}>Problem?</button>
                          </div>
                          {state.targetWordProblemPanelShown && (
                            <div style={{marginTop: '0.5em'}}>
                              <button
                                className="App-small-button"
                                onClick={() => {dispatch({type: 'targetWordIgnore'})}}
                              >Ignore Word</button>{' '}
                              <button
                                className={'App-small-button' + (state.targetWordNotInFragment ? ' App-button-selected' : '')}
                                onClick={() => {dispatch({type: 'targetToggleWordNotInFragment'})}}
                              >Highlight Is Not This Word</button>
                            </div>
                          )}
                          <div style={{marginTop: '1em'}}>
                            <RadioButtons
                              options={[
                                {val: 'y', name: 'Yes'},
                                {val: 'n', name: 'No'},
                              ]}
                              val={maybeBoolToYN(state.targetWordKnown)}
                              onUpdate={(newKey: string) => {dispatch({type: 'updateTargetWordKnown', val: newKey === 'y'})}}
                            />
                          </div>
                        </div>
                        {shouldAskAgreeToSRS(state) && (
                          <div className="QuizPage-space-above">
                            <div className="QuizPage-section-label">Learn Word? (SRS)</div>
                            {/* abusing radio buttons here, these submit immediately */}
                            <RadioButtons
                              options={[
                                {val: 'agree', name: 'Yes'},
                                {val: 'ignore', name: 'No (Ignore)'},
                              ]}
                              val={null}
                              onUpdate={(newKey: string) => {
                                if (newKey === 'agree') {
                                  dispatch({type: 'targetWordAgreeToSRS'});
                                } else if (newKey === 'ignore') {
                                  dispatch({type: 'targetWordIgnore'});
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
                    <div className="QuizPage-big-space-above">
                      <button className="App-chonky-button" onClick={() => {dispatch({type: 'revealGrading'})}}>Continue</button>
                    </div>
                  )}
                </>
              );
          }
        })()}
      </div>
    </>
  );
}

export default QuizPage;
