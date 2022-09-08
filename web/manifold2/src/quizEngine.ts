import dayjs, { Dayjs } from 'dayjs'
import { searchFragments } from './massifAPI';

import { loadAllWords, loadDayStats, storeDayStats } from './storage';
import { invariant, randomChoice } from './util';

const DAILY_INTRO_LIMIT = 10;

export interface QuizEngineConfig {
  // TODO: reference to Massif-API impl, so it can be mocked for testing
}

export enum WordStatus {
  // We are tracking the user's knowledge of this word, but it's neither
  // in SRS or queued to be added to SRS.
  Tracked = 'T',

  // The word is queued to be added to SRS.
  Queued = 'Q',

  // The word is in SRS, in the initial "learning" phase
  Learning = 'L',

  // The word is in SRS, in the longer-term "reviewing" phase
  Reviewing = 'R',
}

export enum WordKnown {
  // The word is in SRS, which supercedes any other estimate of known-ness
  SRS = 'S',

  // We think the word is more likely to be known/not-known by the user
  Yes = 'Y',
  No = 'N',

  // We have no guess either way as to if the user knows this word
  Maybe = 'M',
}

/**
 * We call this a "Word" for simplicity but it may be a multi-word phrase,
 * or in the future perhaps even a grammar pattern.
 *
 * Normally I would not have field interpretations vary based on the status
 * field and use a tagged union, but doing it this way makes it easier to
 * map to the local (relational) database.
 *
 * immutable
 */
export interface Word {
  // unique integer id
  readonly id: number;

  // In the simplest case, this will just be the text of the word in its
  // normalized (dictionary) form, e.g. '食べる'. But this could also be
  // a multi-word phrase like '表情を浮かべる'.
  // TODO: We may also a quoted exact text like '"あろう"', or make that a
  // separate flag?
  // Currently this is identical to a Massif search string, but this might
  // not always be the case.
  readonly text: string;

  // tokenization of the text field. the details of this are complex
  readonly tokens: ReadonlyArray<string>;

  readonly status: WordStatus;

  // rough guess as to whether or not the user knows this word, whatever that means
  readonly known: WordKnown;

  // next time to review/present to user (usually). depending on status:
  // - Tracked: (ignored) 0
  // - Queued: unix time in integer seconds that it was _enqueued_
  // - Learning: unix time in integer seconds to be reviewed
  // - Reviewing: day number (days since 1970-01-01) to be reviewed
  readonly nextTime: number;

  // SRS interval. depending on status:
  // - Tracked/Queued: (ignored) 0, or last interval in days if it used to be Reviewing
  // - Learning: seconds until next review
  // - Reviewing: days until next review
  readonly interval: number;

  // time added to database. unix time in integer seconds
  readonly timeAdded: number;

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
  readonly words: ReadonlyMap<number, Word>;

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
    todayStats,
  };
}

// immutable
interface WordsAnalysis {
  // words due for review now. highest-priority word will be first
  readonly dueWords: ReadonlyArray<Word>;

  // if defined and >0, there must be no dueWords, and this is the time in
  // seconds until the next learning-status word is due for review. this is
  // undefined if nothing is due and there are no upcoming learning reviews.
  readonly timeUntilNextLearning: number | undefined;
}

function analyzeWords(state: QuizEngineState, time: Dayjs): WordsAnalysis {
  // there is not an efficient way to do this with map/filter due to iterable
  const learningWords: Array<Word> = [];
  const reviewingWords: Array<Word> = [];
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

  const dueWords: Array<Word> = [];

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

// immutable
export interface Quiz {
  readonly kind:
    'srs_review' | // reviewing a word in SRS
    'srs_suggest' | // suggesting they add a word to SRS if they don't know it
    'probe'; // just checking if they know the target word
  readonly fragmentText: string;
  readonly targetWordText: string;
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

  const wordsAn = analyzeWords(state, time);

  if (wordsAn.dueWords.length > 0) {
    // review due word

    const targetWord = wordsAn.dueWords[0];

    // an word text is currently the same as a Massif search query
    const fragments = await searchFragments(targetWord.text);

    const fragment = randomChoice(fragments.results);

    return {
      kind: 'srs_review',
      fragmentText: fragment.text,
      targetWordText: targetWord.text,
    };
  } else {
    if (state.todayStats.introCount < DAILY_INTRO_LIMIT) {
      // find word to introduce

      // TODO: first check words with Queued status
      throw new Error('unimplemented');
    } else {
      throw new Error('unimplemented');
    }
  }
}

// mutates given state and has side effects
export async function takeFeedback(state: QuizEngineState, time: Dayjs): Promise<void> {
  await storeDayStats(state.todayStats);
}
