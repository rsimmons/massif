import dayjs, { Dayjs } from 'dayjs'

import { FragmentResult, searchFragments } from './massifAPI';
import { getSingleton, loadAllWords, loadDayStats, setSingleton, storeDayStats, storeWord } from './storage';
import { invariant, randomChoice } from './util';
import { addWordToTrie, createEmptyTrie, findWordsInText, Trie, TrieWord } from './wordTrie';
import { ContigTokenization, Token } from './tokenization';
import { addWordToWordIndex, createEmptyWordIndex, getWordFromWordIndex, TokenizedWord, tokenizedWordsAreSame, WordIndex } from './word';
import FREQ_LIST from './freqlist_drama_20k';
// import FILTERED_NORMALS_SET from './freqlist_filtered';

const FURTHER_FILTERED_WORDS = new Set([
  'い',
  'フフフフフ',
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

const logInfo = console.log;

export interface QuizEngineConfig {
  // TODO: reference to Massif-API impl, so it can be mocked for testing
}

export enum WordStatus {
  // We are tracking the user's knowledge of this word, but none of the other
  // statuses apply
  Tracked = 'T',

  // The word is queued to be added to SRS
  Queued = 'Q',

  // The user has chosen to ignore this word (used to be Declined, hence D)
  Ignored = 'D',

  // The word is in SRS, in the initial "learning" phase
  Learning = 'L',

  // The word is in SRS, in the longer-term "reviewing" phase
  Reviewing = 'R',
}

export enum WordKnown {
  // The word is in SRS or Ignored, which supersedes any other estimate of known-ness
  NotApplicable = 'S',

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

  // the last time the `known` field was updated
  timeKnownUpdated: number;

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

export interface Singleton {
  orderingIntroIdx: number | null;
}

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

  // stuff stored to the DB in a single row
  singleton: Singleton;
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

  const singleton = await getSingleton();

  return {
    config,
    words,
    wordIndex,
    nextWordId,
    todayStats,
    singleton,
  };
}

export function needPlacementTest(state: QuizEngineState): boolean {
  return state.singleton.orderingIntroIdx === null;
}

// an ordering of word-groups
export type PlacementTest = Array<{
  readonly words: ReadonlyArray<string>;
  readonly beginIndex: number;
  readonly endIndex: number;
}>;

export function getPlacementTest(): PlacementTest {
  const mapFwdFn = (x: number) => Math.pow(x, 1/3);
  const mapBwdFn = (x: number) => Math.pow(x, 3);

  const PLACEMENT_GROUPS = 16;
  const WORDS_PER_GROUP = 10;
  const PLACEMENT_LOWEST_IDX = 50;

  const lo = mapFwdFn(PLACEMENT_LOWEST_IDX);
  const hi = mapFwdFn(WORD_ORDERING.length);
  const groups: PlacementTest = [];
  let lastEndIdx = 0;
  for (let g = 0; g < PLACEMENT_GROUPS; g++) {
    const newEndIdx = Math.round(mapBwdFn(lo + (hi-lo)*g/(PLACEMENT_GROUPS-1)));

    const idxs: Set<number> = new Set();
    for (let idx = lastEndIdx; idx < newEndIdx; idx++) {
      idxs.add(idx);
    }

    const words: Array<string> = [];
    for (let w = 0; w < WORDS_PER_GROUP; w++) {
      const idx = randomChoice([...idxs]);
      words.push(WORD_ORDERING[idx]);
      idxs.delete(idx);
    }

    groups.push({
      words,
      beginIndex: lastEndIdx,
      endIndex: newEndIdx,
    });
    lastEndIdx = newEndIdx;
  }

  return groups;
}

export function getOrderingIntroIdx(state: QuizEngineState): number | null {
  return state.singleton.orderingIntroIdx;
}

// idempotent
export function setOrderingIntroIdx(state: QuizEngineState, index: number): void {
  logInfo(`ordering intro index set to ${index}`);
  state.singleton.orderingIntroIdx = index;
  setSingleton(state.singleton); // NOTE: we don't await this
}

// immutable
export interface SRSAnalysis {
  // words due for review now. highest-priority word will be first
  readonly dueWords: ReadonlyArray<TrackedWord>;

  // words that will be due today but are not due yet (must be in learning state)
  readonly dueSoonWords: ReadonlyArray<TrackedWord>;

  readonly queuedWords: ReadonlyArray<TrackedWord>;
}

export function getSRSAnalysis(state: QuizEngineState, time: Dayjs): SRSAnalysis {
  // there is not an efficient way to do this with map/filter due to iterable
  const learningWords: Array<TrackedWord> = [];
  const reviewingWords: Array<TrackedWord> = [];
  const queuedWords: Array<TrackedWord> = [];
  for (const tw of state.words.values()) {
    switch (tw.status) {
      case WordStatus.Learning:
        learningWords.push(tw);
        break;

      case WordStatus.Reviewing:
        reviewingWords.push(tw);
        break;

      case WordStatus.Queued:
        queuedWords.push(tw);
        break;
    }
  }

  // sort by ascending nextTime
  learningWords.sort((a, b) => a.nextTime - b.nextTime);
  reviewingWords.sort((a, b) => a.nextTime - b.nextTime);
  queuedWords.sort((a, b) => a.nextTime - b.nextTime);

  const dueWords: Array<TrackedWord> = [];
  const dueSoonWords: Array<TrackedWord> = [];

  // handle words with learning status
  const unixTime = time.unix();
  for (const w of learningWords) {
    if (w.nextTime <= unixTime) {
      dueWords.push(w);
    } else {
      dueSoonWords.push(w);
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
    dueSoonWords,
    queuedWords,
  };
}

export function getSRSIntroStats(state: QuizEngineState): {todayIntroCount: number, todayIntroLimit: number} {
  return {
    todayIntroCount: state.todayStats.introCount,
    todayIntroLimit: DAILY_INTRO_LIMIT,
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
  SUGGEST_QUEUE = 'suggest_queue', // suggest queueing a word to add to SRS if they don't know it
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

  logInfo(`got quiz for target word with spec ${targetWord.spec}`);

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
  invariant(state.singleton.orderingIntroIdx !== null);

  const dayNumber = timeToLogicalDayNum(time);
  if (state.todayStats.dayNumber !== dayNumber) {
    state.todayStats = {
      dayNumber,
      ...INIT_DAY_STATS,
    };
  }

  const trie = buildWordTrie(state);

  const srsAn = getSRSAnalysis(state, time);

  // Build data about known/unknown words by ordering index, to be used for
  // probing user's knowledge, suggesting SRS words to introduce, selecting
  // context fragments.
  const orderingKnownData: Array<[number, boolean]> = [];
  let lowestUnknownWordIdx: number | undefined = undefined;
  const orderingDontSuggestForSRSIdxs: Set<number> = new Set();
  const orderingDontProbeIdxs: Set<number> = new Set();
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

    // look up the word to see if it is in the ordering, and if so what it's index is
    const orderingIdx = getWordFromWordIndex(wordOrderingIndex, word);

    if (orderingIdx !== undefined) {
      if (known !== undefined) {
        orderingKnownData.push([orderingIdx, known]);
      }

      if (known === false) {
        if ((lowestUnknownWordIdx === undefined) || (orderingIdx < lowestUnknownWordIdx)) {
          lowestUnknownWordIdx = orderingIdx;
        }
      }

      const wordInSRSOrExempt = (word.status === WordStatus.Learning) || (word.status === WordStatus.Reviewing) || (word.status === WordStatus.Ignored) || (word.status === WordStatus.Queued);
      if (wordInSRSOrExempt || (known === true)) {
        orderingDontSuggestForSRSIdxs.add(orderingIdx);
      }

      if (wordInSRSOrExempt || (known !== undefined)) {
        orderingDontProbeIdxs.add(orderingIdx);
      }
    }
  }

  // Do we have very limited data about what words (in the ordering) that the
  // user knows or doesn't know?
  logInfo(`ordering known data: ${countKnown} known, ${countNotKnown} not-known, ${orderingKnownData.length} total`);

  // Are there any SRS words due?
  logInfo(`${srsAn.dueWords.length} words due for SRS`);
  if (srsAn.dueWords.length > 0) {
    // review due word

    const targetWord = srsAn.dueWords[0];

    logInfo(`doing SRS quiz for due word spec: ${targetWord.spec}`, targetWord);
    return getQuizForTargetWord(state, QuizKind.SRS_REVIEW, targetWord, trie);
  }

  // Are we still OK to suggest more words to add to SRS?
  logInfo(`today's SRS intro count is ${state.todayStats.introCount}`);
  if (state.todayStats.introCount < DAILY_INTRO_LIMIT) {
    // introduce or suggest something
    logInfo(`looking for a word to suggest adding to SRS if not-known`);

    // first check words with Queued status. if so we can add to SRS right here, no need to "suggest"
    if (srsAn.queuedWords.length > 0) {
      const firstQueuedWord = srsAn.queuedWords[0];
      logInfo(`intro-reviewing queued word with spec: ${firstQueuedWord.spec}`, firstQueuedWord);
      // NOTE: We could do SUGGEST_SRS here, but the user as already added this to their queue,
      // clearly expressing their intention to SRS it. I don't think we want to ask them again.
      // So instead we just review it (even though it's still in Queued state), and the feedback
      // code will add it.
      return getQuizForTargetWord(state, QuizKind.SRS_REVIEW, firstQueuedWord, trie);
    }

    // Pick a word from ordering to suggest adding to SRS if not known

    if ((lowestUnknownWordIdx !== undefined) && (lowestUnknownWordIdx <= state.singleton.orderingIntroIdx)) {
      // NOTE: This is the index of the lowest word explicitly marked not-known, not just the lowest
      // word that we are unsure about
      logInfo(`found tracked-as-not-known word below the probably-known index (${state.singleton.orderingIntroIdx}) at index ${lowestUnknownWordIdx} to suggest`);
      return getQuizForOrderingIdx(state, QuizKind.SUGGEST_SRS, lowestUnknownWordIdx, trie);
    } else {
      // work upward from orderingIntroIdx until we find an acceptable word to suggest
      for (let idx = state.singleton.orderingIntroIdx; idx < WORD_ORDERING.length; idx++) {
        if (!orderingDontSuggestForSRSIdxs.has(idx)) {
          logInfo(`worked up from probably-known index and found acceptable word at index ${idx} to suggest`);
          return getQuizForOrderingIdx(state, QuizKind.SUGGEST_SRS, idx, trie);
        }
      }
      throw new Error('could not find any word in ordering to suggest');
    }
  }

  // nothing due to review, and daily intro limit has been hit
  logInfo(`reached daily limit for SRS intros`);

  // probe ordering indexes downward from orderingIntroIdx that are not tracked
  // or tracked but have known-status Maybe, so as to discover any holes in the user's knowledge
  logInfo(`looking for for ordering word with no clear known-status below intro index`);
  for (let idx = state.singleton.orderingIntroIdx; idx >= 0; idx--) {
    if (!orderingDontProbeIdxs.has(idx)) {
      logInfo(`probing at index ${idx}`);
      return getQuizForOrderingIdx(state, QuizKind.SUGGEST_QUEUE, idx, trie);
    }
  }

  throw new Error('unimplemented: nothing left to do');
}

export interface Feedback {
  readonly fragmentUnderstood: boolean;
  readonly targetWordKnown: boolean | undefined;
  readonly targetWordIgnored: boolean; // user has chosen to ignore the target word
  readonly targetWordNotInFragment: boolean;
  readonly targetWordAgreedToSRS: boolean | undefined;
}

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
    timeKnownUpdated: time.unix(),
    notes: '',
  };

  state.words.set(newWordId, newTW);

  addWordToWordIndex(state.wordIndex, newTW, newTW);

  return newTW;
}

function addWordToSRS(tw: TrackedWord, time: Dayjs): void {
  // make sure it's not already being SRS'd
  invariant((tw.status !== WordStatus.Learning) && (tw.status !== WordStatus.Reviewing));

  tw.status = WordStatus.Learning;
  tw.known = WordKnown.NotApplicable;
  tw.timeKnownUpdated = time.unix();
  tw.interval = INITIAL_INTERVAL;
  tw.nextTime = time.unix() + INITIAL_INTERVAL;
}

function jitterInterval(iv: number): number {
  return (1 + 2*JITTER*(Math.random() - 0.5))*iv;
};

function updateWordForSRSSuccess(tw: TrackedWord, time: Dayjs): void {
  logInfo(`SRS success, updating word spec: ${tw.spec}`, tw);

  if (tw.status === WordStatus.Learning) {
    // still in learning
    let nextLearningIterval: number | undefined;
    for (const iv of LEARNING_STEPS) {
      if (iv > tw.interval) {
        nextLearningIterval = iv;
        break;
      }
    }
    if (nextLearningIterval === undefined) {
      // no next learning interval, so graduates to reviewing
      tw.status = WordStatus.Reviewing;
      tw.interval = 1;
      tw.nextTime = timeToLogicalDayNum(time) + tw.interval;
    } else {
      tw.interval = nextLearningIterval;
      tw.nextTime = time.unix() + tw.interval;
    }
  } else if (tw.status === WordStatus.Reviewing) {
    tw.interval = Math.max(1, Math.round(jitterInterval(SUCCESS_MULT*tw.interval)));
    tw.nextTime = timeToLogicalDayNum(time) + tw.interval;
  } else {
    invariant(false, `updateWordForSRSSuccess: unexpected word status ${tw.status}`);
  }

  logInfo(`word after update:`, tw);
}

function updateWordForSRSFailure(tw: TrackedWord, time: Dayjs): void {
  logInfo(`SRS failure, updating word spec: ${tw.spec}`, tw);

  if (tw.status === WordStatus.Learning) {
    // still in learning
    tw.interval = INITIAL_INTERVAL;
    tw.nextTime = time.unix() + tw.interval;
  } else if (tw.status === WordStatus.Reviewing) {
    // reviewing
    tw.interval = Math.max(1, Math.round(jitterInterval(Math.pow(tw.interval, FAIL_EXP))));
    tw.nextTime = timeToLogicalDayNum(time) + tw.interval;
  } else {
    invariant(false, `updateWordForSRSFailure: unexpected word status ${tw.status}`);
  }

  logInfo(`word after update:`, tw);
}

// mutates given state and has side effects
export async function takeFeedback(state: QuizEngineState, time: Dayjs, quiz: Quiz, feedback: Feedback): Promise<void> {
  logInfo(`took feedback`, feedback);

  invariant(!(feedback.targetWordIgnored && feedback.targetWordAgreedToSRS));

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

    if (feedback.fragmentUnderstood) {
      const wordInSRS = (wt.status === WordStatus.Learning) || (wt.status === WordStatus.Reviewing);
      invariant((wordInSRS && (wt.known === WordKnown.NotApplicable)) || (!wordInSRS && (wt.known !== WordKnown.NotApplicable)));
      // TODO: if word is queued, should we add to SRS as we do below if it's the target?
      if (wordInSRS) {
        updateWordForSRSSuccess(wt, time);
      } else {
        wt.known = WordKnown.Yes;
        wt.timeKnownUpdated = time.unix();
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

  // check if user decided to ignore the target word
  if (feedback.targetWordIgnored) {
    targetWordTracking.status = WordStatus.Ignored;
    targetWordTracking.known = WordKnown.NotApplicable;
    targetWordTracking.timeKnownUpdated = time.unix();
  } else {
    invariant(feedback.targetWordKnown !== undefined);

    if (feedback.targetWordKnown) {
      if (targetWordInSRS) {
        updateWordForSRSSuccess(targetWordTracking, time);
      } else if (targetWordTracking.status === WordStatus.Queued) {
        // if word is queued, add it first and then do regular update
        addWordToSRS(targetWordTracking, time);
        state.todayStats.introCount++;
        updateWordForSRSSuccess(targetWordTracking, time);
      } else {
        targetWordTracking.known = WordKnown.Yes;
        targetWordTracking.timeKnownUpdated = time.unix();
      }
    } else {
      // target word not known
      if (targetWordInSRS) {
        updateWordForSRSFailure(targetWordTracking, time);
      } else if (targetWordTracking.status === WordStatus.Queued) {
        // if word is queued, add it first and then do regular update
        addWordToSRS(targetWordTracking, time);
        state.todayStats.introCount++;
        updateWordForSRSFailure(targetWordTracking, time);
      } else {
        targetWordTracking.known = WordKnown.No;
        targetWordTracking.timeKnownUpdated = time.unix();
      }
    }

    // Did the user agreed to add the word to SRS?
    if (feedback.targetWordAgreedToSRS) {
      if (state.todayStats.introCount < DAILY_INTRO_LIMIT) {
        // Add word to SRS
        addWordToSRS(targetWordTracking, time);
        state.todayStats.introCount++;
      } else {
        targetWordTracking.status = WordStatus.Queued;
        targetWordTracking.nextTime = time.unix();
      }
    }
  }

  await storeWord(targetWordTracking);

  await storeDayStats(state.todayStats);
}
