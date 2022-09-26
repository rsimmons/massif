import Dexie, { Table } from 'dexie';
import { TrackedWord, WordStatus, DayStats, WordKnown } from './quizEngine';

const DB_NAME = 'manifold';

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
  readonly notes: string;
}

interface DBDayStats {
  readonly dayNumber: number;
  readonly introCount: number;
}

class ManifoldDB extends Dexie {
  word!: Dexie.Table<DBWord, number>;
  dayStats!: Dexie.Table<DBDayStats, number>;

  constructor() {
    super(DB_NAME);

    // NOTE: Not all fields must be specified, only the ones to be indexed on.
    // And the first field is automatically the (unique) primary key.
    this.version(1).stores({
      word: '++id',
      dayStats: 'dayNumber',
    });
  }
}

const db = new ManifoldDB();

export async function loadAllWords(): Promise<Map<number, TrackedWord>> {
  return new Map((await db.word.toArray()).map(a => [a.id, a]));
}

export async function loadDayStats(dayNumber: number): Promise<DayStats | undefined> {
  return await db.dayStats.get(dayNumber);
}

export async function storeDayStats(ds: DayStats): Promise<void> {
  await db.dayStats.put(ds);
}

// only used for testing
export async function deleteDatabase(): Promise<void> {
  await db.delete();
}
