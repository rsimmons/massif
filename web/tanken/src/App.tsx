import React from 'react';
import { useEffectReducer, EffectReducer, EffectsMap, InitialEffectStateGetter, EffectFunction, EffectEntity } from "use-effect-reducer";

import FREQ_LIST from './freqlist_drama_20k';
import FILTERED_NORMALS_SET from './freqlist_filtered';

import './App.css';

const NORMAL_TO_FREQ_INDEX = new Map(FREQ_LIST.map((normal, idx) => [normal, idx]));

function logit(p: number) {
  return Math.log(p / (1 - p));
}

function sqr(x: number) {
  return x*x;
}

function randomChoice<T>(arr: ReadonlyArray<T>): T {
  if (arr.length < 1) {
    throw new Error();
  }
  return arr[Math.floor(Math.random() * arr.length)];
}

// Globals set by Flask in index.html
declare const MASSIF_URL_API_GET_NORMAL_FRAGMENTS: string;

interface QuizLogEntry {
  readonly fragmentText: string;
  readonly understood: boolean;
}

interface TankenState {
  readonly quizLog: ReadonlyArray<QuizLogEntry>;
  readonly seenFragTexts: ReadonlySet<string>;
  readonly controlState: {
    readonly quizIndex: number;
  },
  readonly uiState: TankenUIState;
}

interface Fragment {
  readonly text: string;
  readonly reading: string;
  readonly normals: ReadonlyArray<string>; // array elements should be unique
}

type TankenUIState =
  {
    readonly type: 'home';
  } | {
    readonly type: 'fetching';
  } | {
    readonly type: 'quizzing';
    readonly fragmentText: string;
  } | {
    readonly type: 'error';
    readonly message: string;
  };

type TankenEvent =
  {
    readonly type: 'fetched_fragments';
    readonly normal: string;
    readonly fragments: ReadonlyArray<Fragment>;
  } | {
    readonly type: 'quiz_answered';
    readonly understood: boolean;
  } | {
    readonly type: 'error';
    readonly message: string;
  };

type TankenEffect =
  {
    readonly type: 'fetch_fragments';
    readonly normal: string;
  };

type TankenDispatch = React.Dispatch<TankenEvent>;
// This type was annoying to figure out
type TankenExec = (effect: TankenEffect | EffectFunction<TankenState, any, TankenEffect>) => EffectEntity<TankenState, TankenEvent>;

// Since this code needs to run both at initialization time and after user answers quiz,
// it is factored out here.
function pickNormalAndFetchFragments(state: TankenState, exec: TankenExec): TankenState {
  if (state.uiState.type !== 'home') {
    throw new Error;
  }

  let recentSuccesses = 0;
  let recentReviews = 0;
  state.quizLog.slice(-20).forEach(logEntry => {
    recentSuccesses += logEntry.understood ? 1 : 0;
    recentReviews += 1;
  });
  const rawRecentPct = recentSuccesses / recentReviews;
  console.log('Raw recent pct', rawRecentPct);
  // Add "regularization", I think this would be called, of one success and one failure
  recentSuccesses += 1;
  recentReviews += 2;
  const adjRecentPct = recentSuccesses / recentReviews;
  console.log('Adj recent pct', adjRecentPct);

  const recentLogit = logit(adjRecentPct);
  const TARGET_SUCCESS_PCT = 0.8;
  const targetLogit = logit(TARGET_SUCCESS_PCT);

  const error = recentLogit - targetLogit;

  console.log('Error', error);

  console.log('Previous index', state.controlState.quizIndex);

  const K_P = 1;
  const unjitteredNewQuizIndex = Math.floor(sqr(Math.sqrt(state.controlState.quizIndex) + K_P*error));
  console.log('Unjittered new index', unjitteredNewQuizIndex);

  const MAX_JITTER = 50;
  const jitteredNewQuizIndex = unjitteredNewQuizIndex + Math.floor(MAX_JITTER*Math.random());

  if ((jitteredNewQuizIndex < 100) || (jitteredNewQuizIndex >= FREQ_LIST.length)) {
    throw new Error();
  }

  const newQuizIndex = jitteredNewQuizIndex;
  console.log('New index', newQuizIndex);

  const quizNormal = FREQ_LIST[newQuizIndex];

  console.log(`picked index ${newQuizIndex}, normal ${quizNormal}`);

  exec({
    type: 'fetch_fragments',
    normal: quizNormal,
  });

  return {
    ...state,
    controlState: {
      quizIndex: newQuizIndex,
    },
    uiState: {
      type: 'fetching',
    },
  };
}

const reducer: EffectReducer<TankenState, TankenEvent, TankenEffect> = (state, event, exec) => {
  switch (event.type) {
    case 'fetched_fragments': {
      const seenFrags = [];
      const unseenFrags = [];

      const targetNormalIdx = NORMAL_TO_FREQ_INDEX.get(event.normal);
      if (targetNormalIdx === undefined) {
        throw new Error();
      }

      for (const frag of event.fragments) {
        let maxNormalIdx = 0;
        for (const normal of frag.normals) {
          // ignore normals from this list (basic stuff like particles)
          if (FILTERED_NORMALS_SET.has(normal)) {
            continue;
          }

          const idx = NORMAL_TO_FREQ_INDEX.get(normal);
          if (idx === undefined) {
            console.log('no index for normal', normal);
            // if not in our list, consider it really rare (even though it might just be a name or something)
            maxNormalIdx = Infinity;
          } else {
            maxNormalIdx = Math.max(maxNormalIdx, idx);
          }
        }

        if (targetNormalIdx !== maxNormalIdx) {
          // The target normal was not the rarest normal in this fragment, so skip this fragment
          // console.log('skipping frag', frag);
          continue;
        }

        if (state.seenFragTexts.has(frag.text)) {
          seenFrags.push(frag);
        } else {
          unseenFrags.push(frag);
        }
      }
      console.log(seenFrags, unseenFrags);

      if (unseenFrags.length === 0) {
        throw new Error();
      }

      const chosenFragment = randomChoice(unseenFrags);

      return {
        ...state,
        uiState: {
          type: 'quizzing',
          fragmentText: chosenFragment.text,
        },
      }
    }

    case 'quiz_answered': {
      if (state.uiState.type !== 'quizzing') {
        throw new Error();
      }

      const stateAfterAnswer: TankenState = {
        ...state,
        quizLog: [...state.quizLog, {
          fragmentText: state.uiState.fragmentText,
          understood: event.understood,
        }],
        uiState: {
          type: 'home',
        },
      };

      return pickNormalAndFetchFragments(stateAfterAnswer, exec);
    }

    case 'error':
      return {
        ...state,
        uiState: {
          type: 'error',
          message: event.message,
        },
      };
  }
}

const effectsMap: EffectsMap<TankenState, TankenEvent, TankenEffect> = {
  fetch_fragments: (_, effect, dispatch) => {
    (async () => {
      let response: Response;
      try {
        response = await fetch(MASSIF_URL_API_GET_NORMAL_FRAGMENTS, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            normal: effect.normal,
          }),
        });
      } catch {
        dispatch({type: 'error', message: 'fragments fetch failed'});
        return;
      }

      if (!response.ok) {
        dispatch({type: 'error', message: 'fragments fetch had bad status'});
        return;
      }

      const content = await response.json();

      // NOTE: We don't validate that this has the right shape

      dispatch({
        type: 'fetched_fragments',
        normal: effect.normal,
        fragments: content,
      });
    })();
  },
};

const createInitialState: InitialEffectStateGetter<TankenState, TankenEvent, TankenEffect> = (exec) => {
  return pickNormalAndFetchFragments({
    quizLog: [],
    seenFragTexts: new Set(),
    controlState: {
      // stable at 2700-ish for me?
      quizIndex: 2700,
    },
    uiState: {
      type: 'home',
    },
  }, exec);
}

const App: React.FC = () => {
  const [state, dispatch] = useEffectReducer(reducer, createInitialState, effectsMap);

  return (
    <div className="Tanken" style={{padding: '2em', fontSize: '24px'}}>
      {(() => {
        switch (state.uiState.type) {
          case 'home':
            throw new Error();

          case 'error':
            return <>Error: {state.uiState.message}</>;

          case 'fetching':
            return <>Fetching...</>;

          case 'quizzing':
            return (<>
              <div>{state.uiState.fragmentText}</div>
              <div>Understand?
                <button onClick={() => { dispatch({type: 'quiz_answered', understood: true})}}>Yes</button>
                <button onClick={() => { dispatch({type: 'quiz_answered', understood: false})}}>No</button>
              </div>
            </>);
        }
      })()}
    </div>
  );
};

export default App;
