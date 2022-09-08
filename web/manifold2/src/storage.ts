import Dexie, { Table } from 'dexie';
import { Atom, AtomStatus, DayStats } from './quizEngine';

const DB_NAME = 'manifold';

// This currently matches quizEngine Atom, but that may not always be the case
interface DBAtom {
  readonly id: number;
  readonly spec: string;
  readonly status: AtomStatus;
  readonly reviewTime: number;
  readonly interval: number;
  readonly timeAdded: number;
  readonly notes: string;
}

interface DBDayStats {
  readonly dayNumber: number;
  readonly introCount: number;
}

class ManifoldDB extends Dexie {
  atom!: Dexie.Table<DBAtom, number>;
  dayStats!: Dexie.Table<DBDayStats, number>;

  constructor() {
    super(DB_NAME);

    // NOTE: Not all fields must be specified, only the ones to be indexed on.
    // And the first field is automatically the (unique) primary key.
    this.version(1).stores({
      atom: '++id',
      dayStats: 'dayNumber',
    });
  }
}

const db = new ManifoldDB();

export async function loadAllAtoms(): Promise<ReadonlyMap<number, Atom>> {
  return new Map((await db.atom.toArray()).map(a => [a.id, a]));
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
