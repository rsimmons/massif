import 'fake-indexeddb/auto'; // fake in-memory indexeddb for testing
import dayjs from 'dayjs';
import { initState } from '../quizEngine';
import { deleteDatabase } from '../storage';

const t0 = dayjs('2022-09-07T23:59:36.968Z');

afterEach(async () => {
  await deleteDatabase();
});

test('initializing', async () => {
  const state = await initState({}, t0);
});
