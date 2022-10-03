import { humanTime } from '../util';

test('humanTime', () => {
  const CASES: ReadonlyArray<[number, string]> = [
    [0, '0s'],
    [0.1, '<1s'],
    [0.9, '<1s'],
    [1.1, '1s'],
    [1.9, '2s'],
    [2.1, '2s'],
    [59, '59s'],
    [59.1, '59s'],
    [59.9, '60s'],
    [60, '1m'],
    [61, '1m'],
    [89, '1m'],
    [91, '2m'],
    [3599, '60m'],
    [3600, '1h'],
    [3601, '1h'],
    [7199, '2h'],
    [86400, '24h'],
  ];
  for (const c of CASES) {
    expect(humanTime(c[0])).toBe(c[1]);
  }
});
