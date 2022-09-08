import dayjs, { Dayjs } from 'dayjs'
import { searchFragments } from './massifAPI';

import { loadAllAtoms, loadDayStats, storeDayStats } from './storage';
import { invariant, randomChoice } from './util';

const DAILY_INTRO_LIMIT = 10;

export interface QuizEngineConfig {
  // TODO: reference to Massif-API impl, so it can be mocked
}

export enum AtomStatus {
  Learning = 'L',
  Reviewing = 'R',
  Queued = 'Q',
  // Deleted = 'D',
}

/**
 * immutable
 * Normally I would not have field interpretations vary based on the status
 * field and use a tagged union, but doing it this way makes it easier to
 * map to the local database, which is relational.
 */
export interface Atom {
  // id. integer
  readonly id: number;

  // spec
  // In the simplest case, this will just be the text of the word in its
  // normalized (dictionary) form, e.g. '食べる'. But this could also be
  // a multi-word phrase like '表情を浮かべる', or a quoted exact text
  // like '"あろう"'.
  // Currently this is identical to a Massif search string, but this might
  // not always be the case.
  // Maybe in the future the spec could be expanded to include something like
  // (conceptually) "こと as in 話さないこと！". We might be able to use language
  // model embeddings to identify similar usages.
  readonly spec: string;

  // status
  readonly status: AtomStatus;

  // review time. depending on status:
  // - Learning: unix time in integer seconds
  // - Reviewing: day number (days since 1970-01-01)
  // - Queued/Deleted: 0 (ignored)
  readonly reviewTime: number;

  // interval. depending on status:
  // - Learning: seconds until next review
  // - Reviewing: days until next review
  // - Queued/Deleted: 0 (ignored)
  readonly interval: number;

  // time added. unix time in integer seconds
  // for Queued atoms, this determines order of introduction
  readonly timeAdded: number;

  // user notes
  readonly notes: string;
}

export interface DayStats {
  // per timeToLogicalDayNum
  readonly dayNumber: number;

  // how many new SRS atoms have been introduced
  introCount: number;
}

const INIT_DAY_STATS = {
  introCount: 0,
};

// mutable
export interface QuizEngineState {
  readonly config: QuizEngineConfig;

  // key is integer atom id
  readonly atoms: ReadonlyMap<number, Atom>;

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
  const atoms = await loadAllAtoms();

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
    atoms,
    todayStats,
  };
}

// immutable
interface AtomsAnalysis {
  // atoms due for review now. highest-priority atom will be first
  readonly dueAtoms: ReadonlyArray<Atom>;

  // if defined and >0, there must be no dueAtoms, and this is the time in
  // seconds until the next learning-status atom is due for review. this is
  // undefined if nothing is due and there are no upcoming learning reviews.
  readonly timeUntilNextLearning: number | undefined;
}

function analyzeAtoms(state: QuizEngineState, time: Dayjs): AtomsAnalysis {
  // there is not an efficient way to do this with map/filter due to iterable
  const learningAtoms: Array<Atom> = [];
  const reviewingAtoms: Array<Atom> = [];
  for (const a of state.atoms.values()) {
    switch (a.status) {
      case AtomStatus.Learning:
        learningAtoms.push(a);
        break;

      case AtomStatus.Reviewing:
        reviewingAtoms.push(a);
        break;
    }
  }

  // sort by ascending review time. note that rt of there are different units
  learningAtoms.sort((a, b) => a.reviewTime - b.reviewTime);
  reviewingAtoms.sort((a, b) => a.reviewTime - b.reviewTime);

  const dueAtoms: Array<Atom> = [];

  // handle atoms with learning status
  const unixTime = time.unix();
  let timeUntilNextLearning: number | undefined = undefined;
  for (const a of learningAtoms) {
    if (a.reviewTime <= unixTime) {
      dueAtoms.push(a);
      timeUntilNextLearning = 0;
    } else {
      if (dueAtoms.length === 0) {
        timeUntilNextLearning = a.reviewTime - unixTime;
      }
      break;
    }
  }

  // handle atoms with reviewing status
  const dayNum = timeToLogicalDayNum(time);
  for (const a of reviewingAtoms) {
    if (a.reviewTime <= dayNum) {
      dueAtoms.push(a);
    }
  }

  return {
    dueAtoms,
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

  const atomsAn = analyzeAtoms(state, time);

  if (atomsAn.dueAtoms.length > 0) {
    const targetAtom = atomsAn.dueAtoms[0];

    // an atom spec is current the same as a Massif search query
    const fragments = await searchFragments(targetAtom.spec);

    const fragment = randomChoice(fragments.results);

    return {
      kind: 'srs_review',
      fragmentText: fragment.text,
      targetWordText: targetAtom.spec,
    };
  } else {
    throw new Error('unimplemented');
  }
}

// mutates given state and has side effects
export async function takeFeedback(state: QuizEngineState, time: Dayjs): Promise<void> {
  await storeDayStats(state.todayStats);
}
