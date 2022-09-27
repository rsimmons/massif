import dayjs, { Dayjs } from 'dayjs'

import { FragmentResult, searchFragments } from './massifAPI';
import { loadAllWords, loadDayStats, storeDayStats, storeWord } from './storage';
import { invariant, randomChoice } from './util';
import { addWordToTrie, createEmptyTrie, findWordsInText, Trie, TrieWord } from './wordTrie';
import { ContigTokenization, Token } from './tokenization';
import { addWordToWordIndex, createEmptyWordIndex, getWordFromWordIndex, TokenizedWord, tokenizedWordsAreSame, WordIndex } from './word';
import FREQ_LIST from './freqlist_drama_20k';
import { findXGivenProb, rescaleAndFit } from './logreg';
// import FILTERED_NORMALS_SET from './freqlist_filtered';

const FURTHER_FILTERED_WORDS = new Set([
  'い',
]);
const WORD_ORDERING = FREQ_LIST.filter(w => !FURTHER_FILTERED_WORDS.has(w));

// create index of the word ordering.
// the type-parameter is a number, the index into the array (i.e. word rank)
const wordOrderingIndex = createEmptyWordIndex<number>();
WORD_ORDERING.forEach((w, i) => {
  addWordToWordIndex(
    wordOrderingIndex,
    {
      // TODO: This works for now because the ordering only contains single-token words,
      // but later we will need to have them tokenized
      spec: w,
      tokens: w,
    },
    i,
  );
});

const DAILY_INTRO_LIMIT = 10;

const LEARNING_STEPS = [1*60, 10*60];
const GRADUATING_INTERVAL = 18*60*60;
const SUCCESS_MULT = 2.0;
const FAIL_EXP = 0.5;
const JITTER = 0.1; // as proportion of new interval after adjustment

const INITIAL_INTERVAL = LEARNING_STEPS[0];
const LAST_LEARNING_INTERVAL = LEARNING_STEPS[LEARNING_STEPS.length - 1];

function logInfo(msg: string): void {
  console.log(msg);
}

export interface QuizEngineConfig {
  // TODO: reference to Massif-API impl, so it can be mocked for testing
}

export enum WordStatus {
  // We are tracking the user's knowledge of this word, but none of the other
  // statuses apply
  Tracked = 'T',

  // The word is queued to be added to SRS
  Queued = 'Q',

  // The user declined to add the word to SRS when we suggested them to
  Declined = 'D',

  // The word is in SRS, in the initial "learning" phase
  Learning = 'L',

  // The word is in SRS, in the longer-term "reviewing" phase
  Reviewing = 'R',
}

export enum WordKnown {
  // The word is in SRS, which supersedes any other estimate of known-ness
  SRS = 'S',

  // We think the word is more likely to be known/not-known by the user
  Yes = 'Y',
  No = 'N',

  // We have no guess either way as to if the user knows this word
  Maybe = 'M',
}

/**
 * We call this a "TrackedWord" for simplicity but it may be a multi-word phrase,
 * or in the future perhaps even a grammar pattern.
 *
 * Normally I would not have field interpretations vary based on the status
 * field and use a tagged union, but doing it this way makes it easier to
 * map to the local (relational) database.
 *
 * mutable
 */
export interface TrackedWord extends TokenizedWord {
  // unique integer id
  readonly id: number;

  status: WordStatus;

  // rough guess as to whether or not the user knows this word, whatever that means
  known: WordKnown;

  // next time to review/present to user (usually). depending on status:
  // - Tracked: (ignored) 0
  // - Queued: unix time in integer seconds that it was _enqueued_
  // - Learning: unix time in integer seconds to be reviewed
  // - Reviewing: day number (days since 1970-01-01) to be reviewed
  nextTime: number;

  // SRS interval. depending on status:
  // - Tracked/Queued: (ignored) 0, or last interval in days if it used to be Reviewing
  // - Learning: seconds until next review
  // - Reviewing: days until next review
  interval: number;

  // time added to database. unix time in integer seconds
  readonly timeAdded: number;

  // the last time we showed this word to the user. unix time in integer seconds
  timeLastShown: number;

  // notes manually added by user, if any
  readonly notes: string;
}

// mutable
export interface DayStats {
  // per timeToLogicalDayNum
  readonly dayNumber: number;

  // how many new SRS words have been introduced
  introCount: number;
}

const INIT_DAY_STATS = {
  introCount: 0,
};

// mutable
export interface QuizEngineState {
  readonly config: QuizEngineConfig;

  // key is integer word id
  readonly words: Map<number, TrackedWord>;

  readonly wordIndex: WordIndex<TrackedWord>;

  // id (sequential, numeric) for the next word we add
  nextWordId: number;

  // stats about the current day
  todayStats: DayStats;
}

/**
 * By logical day, mean that (as in Anki) until 4am counts as the previous day.
 */
function timeToLogicalDay(time: Dayjs): Dayjs {
  let day = time.startOf('day');
  if (time.hour() < 4) {
    day = time.subtract(1, 'day');
  }
  return day;
}

/**
 * Computes integer day number given time. The number is the count of days
 * since 1970-01-01. As in Anki, until 4am is still the previous day.
 */
function timeToLogicalDayNum(time: Dayjs): number {
  const day = timeToLogicalDay(time);

  const dayNum = day.diff(dayjs('1970-01-01'), 'day');

  return dayNum;
}

export async function initState(config: QuizEngineConfig, time: Dayjs): Promise<QuizEngineState> {
  const words = await loadAllWords();

  const wordIndex = createEmptyWordIndex<TrackedWord>();
  for (const w of words.values()) {
    addWordToWordIndex(wordIndex, w, w);
  }

  const nextWordId = Math.max(0, ...words.keys()) + 1;

  // note that if clocks were messed up, we could end up loading stats for a day
  // that was _not_ the latest day stored in the db
  const dayNumber = timeToLogicalDayNum(time);
  let todayStats = await loadDayStats(dayNumber);
  if (todayStats === undefined) {
    todayStats = {
      dayNumber,
      ...INIT_DAY_STATS,
    };
    await storeDayStats(todayStats);
  }
  invariant(todayStats !== undefined);

  return {
    config,
    words,
    wordIndex,
    nextWordId,
    todayStats,
  };
}

// immutable
interface WordsAnalysis {
  // words due for review now. highest-priority word will be first
  readonly dueWords: ReadonlyArray<TrackedWord>;

  // if defined and >0, there must be no dueWords, and this is the time in
  // seconds until the next learning-status word is due for review. this is
  // undefined if nothing is due and there are no upcoming learning reviews.
  readonly timeUntilNextLearning: number | undefined;
}

function analyzeWords(state: QuizEngineState, time: Dayjs): WordsAnalysis {
  // there is not an efficient way to do this with map/filter due to iterable
  const learningWords: Array<TrackedWord> = [];
  const reviewingWords: Array<TrackedWord> = [];
  for (const a of state.words.values()) {
    switch (a.status) {
      case WordStatus.Learning:
        learningWords.push(a);
        break;

      case WordStatus.Reviewing:
        reviewingWords.push(a);
        break;
    }
  }

  // sort by ascending review time. note that rt of there are different units
  learningWords.sort((a, b) => a.nextTime - b.nextTime);
  reviewingWords.sort((a, b) => a.nextTime - b.nextTime);

  const dueWords: Array<TrackedWord> = [];

  // handle words with learning status
  const unixTime = time.unix();
  let timeUntilNextLearning: number | undefined = undefined;
  for (const a of learningWords) {
    if (a.nextTime <= unixTime) {
      dueWords.push(a);
      timeUntilNextLearning = 0;
    } else {
      if (dueWords.length === 0) {
        timeUntilNextLearning = a.nextTime - unixTime;
      }
      break;
    }
  }

  // handle words with reviewing status
  const dayNum = timeToLogicalDayNum(time);
  for (const a of reviewingWords) {
    if (a.nextTime <= dayNum) {
      dueWords.push(a);
    }
  }

  return {
    dueWords,
    timeUntilNextLearning,
  };
}

// subtypes of trie-related types
type WToken = Token; // token type used in words. this could be a subtype of Token
interface FToken extends Token { // token type used in fragments
  readonly b: number; // begin index
  readonly e: number; // end index
}
interface QTrieWord extends TrieWord<WToken> {
  readonly tword: TokenizedWord;
  // readonly wordRef: WordRef;
}
type QWordTrie = Trie<Token, QTrieWord>;

function buildWordTrie(state: QuizEngineState): QWordTrie {
  const trie = createEmptyTrie<WToken, QTrieWord>();

  // add tracked words
  for (const w of state.words.values()) {
    addWordToTrie(trie, {
      toks: w.tokens.split('|').map(tok => ({t: tok})),
      tword: w,
    });
  }

  // add all words from ordering that are not tracked
  for (const w of WORD_ORDERING) {
    addWordToTrie(trie, {
      // TODO: this will need to be updated once we store tokenizations in ordering
      toks: [{t: w}],
      tword: {
        spec: w,
        tokens: w,
      },
    });
  }

  return trie;
}

interface FindWordsResult {
  readonly foundWords: ReadonlyArray<QTrieWord>;
  readonly unmatchedToks: ReadonlyArray<FToken>;
}

function findWordsInFragment(fragmentText: string, fragmentTokens: ReadonlyArray<ContigTokenization<FToken>>, trie: QWordTrie): FindWordsResult {
  const foundWords: Array<QTrieWord> = [];
  const unmatchedToks: Array<FToken> = [];
  for (const fragContigTokenRun of fragmentTokens) {
    const findResult = findWordsInText(trie, fragContigTokenRun);
    foundWords.push(...findResult.words);
    unmatchedToks.push(...findResult.unmatched);
  }

  return {
    foundWords,
    unmatchedToks,
  };
}

async function getFragmentForTargetWord(state: QuizEngineState, tword: TokenizedWord, trie: QWordTrie): Promise<FragmentResult> {
  // a word text is currently the same as a Massif search query

  // NOTE: This relies on the Massif search string being the same as the "spec" currently
  const fragments = await searchFragments(tword.spec);

  if (fragments.results.length === 0) {
    throw new Error(`could not find any fragments for word spec: ${tword.spec}`);
  }

  const fragment = randomChoice(fragments.results);

  return fragment;
}

export enum QuizKind {
  SRS_REVIEW = 'srs_review', // reviewing a word in SRS
  SUGGEST_SRS = 'suggest_srs', // suggesting they add a word to SRS if they don't know it
  PROBE = 'probe', // just checking if they know the target word
}

// immutable
export interface Quiz {
  readonly kind: QuizKind;
  readonly fragmentText: string;
  readonly fragmentHighlightedHTML: string;
  readonly fragmentTokenization: ReadonlyArray<ReadonlyArray<FToken>>;
  readonly targetWord: TokenizedWord;
}

async function getQuizForTargetWord(state: QuizEngineState, quizKind: QuizKind, targetWord: TokenizedWord, trie: QWordTrie): Promise<Quiz> {
  const fragment = await getFragmentForTargetWord(state, targetWord, trie);

  return {
    kind: quizKind,
    fragmentText: fragment.text,
    fragmentHighlightedHTML: fragment.highlighted_html,
    fragmentTokenization: fragment.tokens,
    targetWord,
  };
}

async function getQuizForOrderingIdx(state: QuizEngineState, quizKind: QuizKind, targetIdx: number, trie: QWordTrie): Promise<Quiz> {
  const w = WORD_ORDERING[targetIdx];
  const tword: TokenizedWord = {
    // TODO: This works for now because the ordering only contains single-token words,
    // but later we will need to have them tokenized
    spec: w,
    tokens: w,
  };
  return getQuizForTargetWord(state, quizKind, tword, trie);
}

// mutates given state and has side effects
export async function getNextQuiz(state: QuizEngineState, time: Dayjs): Promise<Quiz> {
  const dayNumber = timeToLogicalDayNum(time);
  if (state.todayStats.dayNumber !== dayNumber) {
    state.todayStats = {
      dayNumber,
      ...INIT_DAY_STATS,
    };
  }

  const trie = buildWordTrie(state);

  const wordsAn = analyzeWords(state, time);

  // Build data about known/unknown words by ordering index, to be used for
  // probing user's knowledge, suggesting SRS words to introduce, picking
  // context fragments.
  const pickerData: Array<[number, boolean]> = [];
  const pickerDataIdxs: Set<number> = new Set(); // the set of idxs in pickerData
  let lowestUnknownWordIdx: number | undefined = undefined;
  const dontSuggestSRSWordIdxs: Set<number> = new Set();
  let countKnown = 0;
  let countNotKnown = 0;
  for (const word of state.words.values()) {
    let known: true | false | undefined = undefined;
    if (word.status === WordStatus.Learning) {
      known = true;
    } else if (word.status === WordStatus.Reviewing) {
      known = true;
    } else if (word.status === WordStatus.Tracked) {
      if (word.known === WordKnown.Yes) {
        known = true;
      } else if (word.known === WordKnown.No) {
        known = false;
      }
    }

    if (known === true) {
      countKnown++;
    } else if (known === false) {
      countNotKnown++;
    }

    if (known !== undefined) {
      // look up the word to see if it is in the ordering, and if so what it's index is
      const orderingIdx = getWordFromWordIndex(wordOrderingIndex, word);

      if (orderingIdx !== undefined) {
        pickerData.push([orderingIdx, known]);
        pickerDataIdxs.add(orderingIdx);

        if (known === false) {
          if ((lowestUnknownWordIdx === undefined) || (orderingIdx < lowestUnknownWordIdx)) {
            lowestUnknownWordIdx = orderingIdx;
          }
        }

        const wordInSRS = (word.status === WordStatus.Learning) || (word.status === WordStatus.Reviewing);
        if (wordInSRS || (word.status === WordStatus.Declined) || (known === true)) {
          dontSuggestSRSWordIdxs.add(orderingIdx);
        }
      }
    }
  }

  // Do we have very limited data about what words (in the ordering) that the
  // user knows or doesn't know?
  logInfo(`picker data: ${countKnown} known, ${countNotKnown} not-known, ${pickerData.length} total`);

  // Add padding/dummy elements to picker data to help it give reasonable results
  // when there is little or no actual user data
  const PADDING_DATA: ReadonlyArray<[number, boolean]> = [
    [-1, true],
    [100, true],
    [3000, false],
    [WORD_ORDERING.length, false],
  ];
  const LOW_DATA_PAD_THRESH = 5;
  const paddedPickerData: ReadonlyArray<[number, boolean]> = ((countKnown < LOW_DATA_PAD_THRESH) || (countNotKnown < LOW_DATA_PAD_THRESH)) ? [...PADDING_DATA, ...pickerData] : pickerData;

  // Convert the "known" flag from boolean to int
  const paddedNumPickerData: ReadonlyArray<[number, 0 | 1]> = paddedPickerData.map(([i, known]) => [i, known ? 1 : 0]); // convert bools to nums

  const clampIndexToOrdering = (idx: number) => Math.max(Math.min(idx, WORD_ORDERING.length-1), 0);

  // Determine how many iterations of logistic regression to do. As we have more data,
  // we do fewer iterations.
  const logRegIters = Math.min(10000, Math.ceil(100000/paddedNumPickerData.length));

  // Do logistic regression, i.e. fit a logistic curve to the (padded data)
  const LOGREG_REGULARIZATION = 0.001; // only need a little bit to prevent explosion with linearly separable data
  const LOGREG_LEARN_RATE = 1; // this seems plenty stable, tho surely not optimal
  const fitT0 = Date.now();
  const fr = rescaleAndFit(paddedNumPickerData, LOGREG_REGULARIZATION, LOGREG_LEARN_RATE, logRegIters);
  logInfo(`logistic regression took ${Math.round(Date.now()-fitT0)}ms for ${logRegIters} iterations`);

  // the index (before clamping to reasonable bounds) at which the model predicts
  // the user "probably" knows a word
  const PROBABLY_KNOWN_PROB = 0.8; // what probability is "probably" for our purposes?
  const unclampedProbablyKnownIdx = Math.round(findXGivenProb(fr, PROBABLY_KNOWN_PROB));

  const probablyKnownIdx = clampIndexToOrdering(unclampedProbablyKnownIdx);

  logInfo(`logreg model says words known with ${PROBABLY_KNOWN_PROB} prob at index ${unclampedProbablyKnownIdx} (unclamped), ${probablyKnownIdx} (clamped)`);

  const otherProbIndexes = [0.5, 0.6, 0.75, 0.8, 0.85, 0.9, 0.95].map(prob => [prob, Math.round(findXGivenProb(fr, prob))]);
  console.log('logreg model gives for probability, index', otherProbIndexes);

  // Until we have this many data points about words known or not-known, keep probing
  const PROBE_UNTIL_WORD_DATA_POINTS = 100;
  if (pickerData.length < PROBE_UNTIL_WORD_DATA_POINTS) {
    // Continue to probe the user's knowledge, like a proficiency test
    logInfo(`not enough word data to confidently model user's knowledge, so probing`);

    // pick an index randomly within a window of this radius around the index logistic regression gave us
    const PROBE_JITTER_RADIUS = 20;

    // find the (clamped) window indexes
    const probeWindowMin = clampIndexToOrdering(probablyKnownIdx - PROBE_JITTER_RADIUS);
    const probeWindowMax = clampIndexToOrdering(probablyKnownIdx + PROBE_JITTER_RADIUS);
    const probeWindowSize = probeWindowMax - probeWindowMin;
    invariant(probeWindowSize > 0);

    // we want to avoid choosing indexes that we already have data for, so compute
    // the set of "pickable" indexes
    const probeWindowPickable: Set<number> = new Set();
    for (let idx = probeWindowMin; idx < probeWindowMax; idx++) {
      probeWindowPickable.add(idx);
    }
    let probeWindowCount = 0;
    let probeWindowKnown = 0;
    for (const [idx, known] of pickerData) {
      if ((idx >= probeWindowMin) && (idx < probeWindowMax)) {
        probeWindowPickable.delete(idx);
        probeWindowCount++;
        if (known) {
          probeWindowKnown++;
        }
      }
    }
    invariant(probeWindowPickable.size > 0); // there must be some pickable indexes

    logInfo(`clamped probe window from ${probeWindowMin} to ${probeWindowMax}, pickable fraction ${probeWindowPickable.size/(probeWindowMax-probeWindowMin)}, within window ${probeWindowKnown} known out of ${probeWindowCount} (${100*probeWindowKnown/probeWindowCount}%)`);

    // do the random pick to get the jittered index
    const jitteredProbeIdx = randomChoice([...probeWindowPickable]);

    logInfo(`jittered probe index is ${jitteredProbeIdx}`);

    // out of curiosity, how many word are not-known below the jittered probe index?
    let unknownBelowCount = 0;
    for (const [idx, known] of pickerData) {
      if ((idx < jitteredProbeIdx) && !known) {
        unknownBelowCount++;
      }
    }
    logInfo(`${unknownBelowCount} not-known below jittered probe idx`);

    return getQuizForOrderingIdx(state, QuizKind.PROBE, jitteredProbeIdx, trie);
  }

  // Are there any SRS words due?
  logInfo(`${wordsAn.dueWords.length} words due for SRS`);
  if (wordsAn.dueWords.length > 0) {
    // review due word

    const targetWord = wordsAn.dueWords[0];

    logInfo(`doing SRS quiz for due word spec: ${targetWord.spec}`);
    return getQuizForTargetWord(state, QuizKind.SRS_REVIEW, targetWord, trie);
  }

  // Are we still OK to suggest more words to add to SRS?
  if (state.todayStats.introCount < DAILY_INTRO_LIMIT) {
    // introduce or suggest something
    logInfo(`looking for a word to suggest adding to SRS`);

    // TODO: first check words with Queued status. if so we can add to SRS right here, no need to "suggest"

    // Pick a word from ordering to suggest

    if ((lowestUnknownWordIdx !== undefined) && (lowestUnknownWordIdx <= probablyKnownIdx)) {
      // NOTE: This is the index of the lowest word explicitly marked not-known, not just the lowest
      // word that we are unsure about
      logInfo(`found tracked-as-not-known word below the probably-known index (${probablyKnownIdx}) at index ${lowestUnknownWordIdx} to suggest`);
      return getQuizForOrderingIdx(state, QuizKind.SUGGEST_SRS, lowestUnknownWordIdx, trie);
    } else {
      // work upward from probablyKnownIdx until we find an acceptable word to suggest
      for (let idx = probablyKnownIdx; idx < WORD_ORDERING.length; idx++) {
        if (!dontSuggestSRSWordIdxs.has(idx)) {
          logInfo(`worked up from probably-known index and found acceptable word at index ${idx} to suggest`);
          return getQuizForOrderingIdx(state, QuizKind.SUGGEST_SRS, idx, trie);
        }
      }
      throw new Error('could not find any word in ordering to suggest');
    }
  }

  // nothing due to review, and daily intro limit has been hit
  throw new Error('unimplemented: nothing due and intro limit hit');

  // TODO: probe ordering indexes downward from probablyKnownIdx that are not tracked
  // or tracked but have known-status Maybe, so as to discover any holes in the user's knowledge
}

export type Feedback =
  {
    readonly kind: 'Fy'; // fragment fully understood
  } | {
    readonly kind: 'FnWy'; // fragment not fully understood, but target word known
  } | {
    readonly kind: 'FnWn'; // fragment not fully understood, and target word not known
  } | {
    readonly kind: 'FnWnAy'; // fragment not fully understood, target word not known, agreed to add to SRS
  } | {
    readonly kind: 'FnWnAn'; // fragment not fully understood, target word not known, declined to add to SRS
  };

function getOrCreateWordTracking(state: QuizEngineState, time: Dayjs, tword: TokenizedWord): TrackedWord {
  const result = getWordFromWordIndex(state.wordIndex, tword);
  if (result !== undefined) {
    return result;
  }

  const newWordId = state.nextWordId;
  state.nextWordId++;

  const newTW: TrackedWord = {
    id: newWordId,

    spec: tword.spec,
    tokens: tword.tokens,

    status: WordStatus.Tracked,
    known: WordKnown.Maybe,
    nextTime: 0,
    interval: 0,
    timeAdded: time.unix(),
    timeLastShown: time.unix(),
    notes: '',
  };

  state.words.set(newWordId, newTW);

  addWordToWordIndex(state.wordIndex, newTW, newTW);

  return newTW;
}

function jitterInterval(iv: number): number {
  return (1 + 2*JITTER*(Math.random() - 0.5))*iv;
};

function updateWordForSRSSuccess(tw: TrackedWord, time: Dayjs): void {
  logInfo(`SRS success, updating word spec: ${tw.spec}`);

  if (tw.interval > LAST_LEARNING_INTERVAL) {
    // was already graduated
    tw.interval = Math.floor(jitterInterval(SUCCESS_MULT*tw.interval));
  } else {
    // was still in learning
    let nextLearningIterval: number | undefined;
    for (const iv of LEARNING_STEPS) {
      if (iv > tw.interval) {
        nextLearningIterval = iv;
        break;
      }
    }
    if (nextLearningIterval === undefined) {
      // graduates
      tw.interval = Math.floor(jitterInterval(GRADUATING_INTERVAL));
    } else {
      tw.interval = nextLearningIterval;
    }
  }

  tw.nextTime = time.unix() + tw.interval;
}

function updateWordForSRSFailure(tw: TrackedWord, time: Dayjs): void {
  logInfo(`SRS failure, updating word spec: ${tw.spec}`);

  if (tw.interval > LAST_LEARNING_INTERVAL) {
    // was already graduated
    tw.interval = Math.floor(jitterInterval(Math.pow(tw.interval, FAIL_EXP)));
  } else {
    // was still in learning
    tw.interval = INITIAL_INTERVAL;
  }

  tw.nextTime = time.unix() + tw.interval;
}

// mutates given state and has side effects
export async function takeFeedback(state: QuizEngineState, time: Dayjs, quiz: Quiz, feedback: Feedback): Promise<void> {
  logInfo(`took feedback of kind ${feedback.kind}`);

  // TODO: if there was an intro, update daily intro count

  await storeDayStats(state.todayStats);

  const trie = buildWordTrie(state);
  const fwr = findWordsInFragment(quiz.fragmentText, quiz.fragmentTokenization, trie);

  // add/update word tracking for words and unmatched tokens found in fragment,
  // but skipping the target word
  for (const fw of fwr.foundWords) {
    if (tokenizedWordsAreSame(fw.tword, quiz.targetWord)) {
      continue;
    }

    const wt = getOrCreateWordTracking(state, time, fw.tword);

    wt.timeLastShown = time.unix();

    if (feedback.kind === 'Fy') {
      const wordInSRS = (wt.status === WordStatus.Learning) || (wt.status === WordStatus.Reviewing);
      invariant((wordInSRS && (wt.known === WordKnown.SRS)) || (!wordInSRS && (wt.known !== WordKnown.SRS)));
      if (wordInSRS) {
        updateWordForSRSSuccess(wt, time);
      } else {
        wt.known = WordKnown.Yes;
      }
    }

    await storeWord(wt);
  }
  for (const umt of fwr.unmatchedToks) {
    // TODO: handle
  }

  // handle the target word

  // add target word to tracking if not already tracked
  const targetWordTracking = getOrCreateWordTracking(state, time, quiz.targetWord);
  const targetWordInSRS = (targetWordTracking.status === WordStatus.Learning) || (targetWordTracking.status === WordStatus.Reviewing);

  targetWordTracking.timeLastShown = time.unix();

  if (feedback.kind === 'Fy') {
    if (targetWordInSRS) {
      updateWordForSRSSuccess(targetWordTracking, time);
    } else {
      targetWordTracking.known = WordKnown.Yes;
    }
  } else {
    // must be Fn*
    if (feedback.kind === 'FnWy') {
      if (targetWordInSRS) {
        updateWordForSRSSuccess(targetWordTracking, time);
      } else {
        targetWordTracking.known = WordKnown.Yes;
      }
    } else {
      // must be FnWn*
      if (targetWordInSRS) {
        updateWordForSRSFailure(targetWordTracking, time);
      } else {
        targetWordTracking.known = WordKnown.No;
      }

      // handle FnWnA*
      if (feedback.kind === 'FnWnAy') {
        // Add word to SRS
        targetWordTracking.status = WordStatus.Learning;
        targetWordTracking.known = WordKnown.SRS;
        targetWordTracking.interval = INITIAL_INTERVAL;
        targetWordTracking.nextTime = time.unix() + INITIAL_INTERVAL;
      } else if (feedback.kind === 'FnWnAn') {
        // Mark word as declined so that we won't suggest it again
        targetWordTracking.status = WordStatus.Declined;
      }
    }
  }
  await storeWord(targetWordTracking);

  console.log('after feedback, words:', state.words);
}
