import Dexie from 'dexie';
import { TrackedWord, WordStatus, DayStats, WordKnown, Singleton } from './quizEngine';
import { invariant } from './util';

const DB_NAME = 'manifold';

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

class ManifoldDB extends Dexie {
  word!: Dexie.Table<DBWord, number>;
  dayStats!: Dexie.Table<DBDayStats, number>;
  singleton!: Dexie.Table<DBSingleton, number>;

  constructor() {
    super(DB_NAME);

    // NOTE: Not all fields must be specified, only the ones to be indexed on.
    // And the first field is automatically the (unique) primary key.
    this.version(1).stores({
      word: '++id',
      dayStats: 'dayNumber',
      singleton: 'id',
    });
  }
}

const db = new ManifoldDB();

db.on('populate', () => {
  db.singleton.add(INIT_SINGLETON);
});

// Expose the db as a global variable for messing around in the console
declare global {
  var manifoldDB: ManifoldDB;
}
globalThis.manifoldDB = db;

export async function loadAllWords(): Promise<Map<number, TrackedWord>> {
  return new Map((await db.word.toArray()).map(a => [a.id, a]));
}

export async function storeWord(w: TrackedWord): Promise<void> {
  await db.word.put(w);
}

export async function loadDayStats(dayNumber: number): Promise<DayStats | undefined> {
  return await db.dayStats.get(dayNumber);
}

export async function storeDayStats(ds: DayStats): Promise<void> {
  await db.dayStats.put(ds);
}

export async function getSingleton(): Promise<Singleton> {
  const row = await db.singleton.get(0);
  invariant(row);
  return row;
}

export async function setSingleton(singleton: Singleton): Promise<void> {
  await db.singleton.put({
    id: 0,
    ...singleton,
  });
}

// only used for testing
export async function deleteDatabase(): Promise<void> {
  await db.delete();
}
