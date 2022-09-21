import { findRank } from '../slidingWindow';

test('empty data', () => {
  expect(findRank([], 0.5, 100, 1000)).toEqual({
    windowBegin: 950,
    windowEnd: 1050,
    confident: false,
  });
});

test('only data below start window', () => {
  expect(findRank([
    [10, true],
    [20, false],
    [30, true],
  ], 0.5, 100, 1000)).toEqual({
    windowBegin: 950,
    windowEnd: 1050,
    confident: false,
  });
});

test('only data above start window', () => {
  expect(findRank([
    [2000, true],
    [2010, false],
    [2020, true],
  ], 0.5, 100, 1000)).toEqual({
    windowBegin: 950,
    windowEnd: 1050,
    confident: false,
  });
});

test('low-index dense unknown data within window', () => {
  expect(findRank([
    [10, false],
    [11, false],
    [12, false],
    [13, false],
    [14, false],
    [15, false],
    [16, false],
    [17, false],
    [18, false],
    [19, false],
  ], 0.5, 100, 1000)).toEqual(50);
});
