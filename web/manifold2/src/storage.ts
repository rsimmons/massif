import Dexie from 'dexie';
import { TrackedWord, WordStatus, DayStats, WordKnown, Singleton } from './quizEngine';
import { invariant } from './util';

const DEFAULT_PROFILE_DB_NAME = 'manifold-default';

const INIT_SINGLETON: DBSingleton = {
  id: 0,
  orderingIntroIdx: null,
};

// This currently matches quizEngine TrackedWord, but that may not always be the case
interface DBWord {
  readonly id: number;
  readonly spec: string;
  readonly tokens: string;
  readonly status: WordStatus;
  readonly known: WordKnown;
  readonly nextTime: number;
  readonly interval: number;
  readonly timeAdded: number;
  readonly timeLastShown: number;
  readonly notes: string;
}

interface DBDayStats {
  readonly dayNumber: number;
  readonly introCount: number;
}

interface DBSingleton {
  readonly id: 0;
  readonly orderingIntroIdx: number | null;
}

class ManifoldProfileDB extends Dexie {
  word!: Dexie.Table<DBWord, number>;
  dayStats!: Dexie.Table<DBDayStats, number>;
  singleton!: Dexie.Table<DBSingleton, number>;

  constructor() {
    super(DEFAULT_PROFILE_DB_NAME);

    // NOTE: Not all fields must be specified, only the ones to be indexed on.
    // And the first field is automatically the (unique) primary key.
    this.version(1).stores({
      word: '++id',
      dayStats: 'dayNumber',
      singleton: 'id',
    });
  }
}

const profileDB = new ManifoldProfileDB();

profileDB.on('populate', () => {
  profileDB.singleton.add(INIT_SINGLETON);
});

// Expose the current profile db as a global variable for messing around in the console
declare global {
  var currentProfileDB: ManifoldProfileDB;
}
globalThis.currentProfileDB = profileDB;

export async function loadAllWords(): Promise<Map<number, TrackedWord>> {
  return new Map((await profileDB.word.toArray()).map(a => [a.id, a]));
}

export async function storeWord(w: TrackedWord): Promise<void> {
  await profileDB.word.put(w);
}

export async function loadDayStats(dayNumber: number): Promise<DayStats | undefined> {
  return await profileDB.dayStats.get(dayNumber);
}

export async function storeDayStats(ds: DayStats): Promise<void> {
  await profileDB.dayStats.put(ds);
}

export async function getSingleton(): Promise<Singleton> {
  const row = await profileDB.singleton.get(0);
  invariant(row);
  return row;
}

export async function setSingleton(singleton: Singleton): Promise<void> {
  await profileDB.singleton.put({
    id: 0,
    ...singleton,
  });
}

// only used for testing
export async function deleteDatabase(): Promise<void> {
  await profileDB.delete();
}
