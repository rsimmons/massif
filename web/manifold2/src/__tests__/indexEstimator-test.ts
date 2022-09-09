import indexRegression from '../indexEstimator';

test('empty data', () => {
  expect(indexRegression([], 0.5)).toBe(undefined);
});

test('TF', () => {
  expect(indexRegression([
    [100, true],
    [200, false],
  ], 0.5)).toBe(undefined); // this is debatable but the logic is consistent
});

test('TTFF', () => {
  expect(indexRegression([
    [50, true],
    [200, true],
    [300, false],
    [1000, false],
  ], 0.5)).toBe(250);
});

test('TTF', () => {
  expect(indexRegression([
    [100, true],
    [600, true],
    [800, false],
  ], 0.5)).toBe(600);
});

test('TFF', () => {
  expect(indexRegression([
    [100, true],
    [300, false],
    [1000, false],
  ], 0.5)).toBe(300);
});

test('T', () => {
  expect(indexRegression([
    [100, true],
  ], 0.5)).toBe(undefined);
});

test('TT', () => {
  expect(indexRegression([
    [100, true],
    [200, true],
  ], 0.5)).toBe(undefined);
});

test('F', () => {
  expect(indexRegression([
    [100, false],
  ], 0.5)).toBe(undefined);
});

test('FF', () => {
  expect(indexRegression([
    [100, false],
    [200, false],
  ], 0.5)).toBe(undefined);
});

test('FT', () => {
  expect(indexRegression([
    [100, false],
    [200, true],
  ], 0.5)).toBe(undefined);
});

test('FFTT', () => {
  expect(indexRegression([
    [100, false],
    [200, false],
    [300, true],
    [400, true],
  ], 0.5)).toBe(undefined);
});


test('TTFFFFFF', () => {
  expect(indexRegression([
    [100, true],
    [200, true],
    [300, false],
    [400, false],
    [500, false],
    [600, false],
    [700, false],
    [800, false],
  ], 0.5)).toBe(250);
});

test('TTTTTTFF', () => {
  expect(indexRegression([
    [100, true],
    [200, true],
    [300, true],
    [400, true],
    [500, true],
    [600, true],
    [700, false],
    [800, false],
  ], 0.5)).toBe(650);
});

test('TFTF', () => {
  expect(indexRegression([
    [100, true],
    [400, false],
    [500, true],
    [520, false],
  ], 0.5)).toBe(450);
});

test('TFFFTTTF', () => {
  expect(indexRegression([
    [100, true],
    [500, false],
    [600, false],
    [700, false],
    [1000, true],
    [1100, true],
    [1300, true],
    [2000, false],
  ], 0.5)).toBe(900); // midpoint of first false and last true, not the middle transition from false to true
});

test('TTTFTFFF', () => {
  const data: Array<[number, boolean]> = [
    [100, true],
    [500, true],
    [600, true], // midpoint of this
    [700, false],
    [1000, true],
    [1100, false], // and this
    [1300, false],
    [2000, false],
  ];

  expect(indexRegression(data, 0.5)).toBe(850);

  // It should work regardless of order
  data.reverse();
  expect(indexRegression(data, 0.5)).toBe(850);
});

test('FFTTTT', () => {
  expect(indexRegression([
    [100, false],
    [200, false],
    [300, true],
    [400, true],
    [500, true],
    [600, true],
  ], 0.5)).toBe(undefined);
});

const FADE = 'TTTTTTTTFTTTFFTTFFTFTFFTFFFFTFFFFTFFFFFFF';
const Fs = 'FFFFFFFFFFFFFFFFFF';
test(FADE, () => {
  const strToData = (s: string): ReadonlyArray<[number, boolean]> => [...s].map((c, i) => [100*(i+1), c === 'T'])
  const data = strToData(FADE);
  expect(indexRegression(data, 0.99)).toBe(900);
  expect(indexRegression(data, 0.01)).toBe(3400);

  // extra unknowns at end should not matter
  const dataExtraFs = strToData(FADE + Fs);
  expect(indexRegression(data, 0.99)).toBe(900);
  expect(indexRegression(data, 0.01)).toBe(3400);
});

// we don't care about the order, so we do least significant bits at start of array
function intToBoolArr(n: number, bits: number): ReadonlyArray<boolean> {
  const result: Array<boolean> = [];
  for (let i = 0; i < bits; i++) {
    result.push((n & (1 << i)) !== 0);
  }
  return result;
}

test('int to bool array helper works', () => {
  expect(intToBoolArr(0, 4)).toEqual([false, false, false, false]);
  expect(intToBoolArr(5, 4)).toEqual([true, false, true, false]);
  expect(intToBoolArr(15, 4)).toEqual([true, true, true, true]);
});

function allBoolArrsUpToLen(maxLen: number): ReadonlyArray<ReadonlyArray<boolean>> {
  const result: Array<ReadonlyArray<boolean>> = [];
  for (let len = 1; len <= maxLen; len++) {
    for (let n = 0; n < (1<<len); n++) {
      result.push(intToBoolArr(n, len));
    }
  }
  return result;
}

test('generating all bool arrays up to len', () => {
  expect(allBoolArrsUpToLen(2)).toEqual([
    [false],
    [true],
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ]);
});

test('all short sequences with dummies', () => {
  for (const arr of allBoolArrsUpToLen(8)) {
    const data: ReadonlyArray<[number, boolean]> = arr.map((b, i) => [100*(i+1), b]);
    const dataWithDummies: ReadonlyArray<[number, boolean]> = [[0, true], ...data, [10000, false]];
    expect(indexRegression(dataWithDummies, 0.01)).toBeDefined();
    expect(indexRegression(dataWithDummies, 0.5)).toBeDefined();
    expect(indexRegression(dataWithDummies, 0.99)).toBeDefined();
  }
});

/**
 * The below doesn't work as an actual test, but can be used to manually play
 * around with parameters and see how the algorithm works with data provided
 * by a sampled logistic curve. It does _not_ converge on estimating the
 * a priori known correct point on the curve, which is fine.
 */
/*
function logistic(x: number, midpoint: number, rate: number): number {
  return 1/(1 + Math.exp(rate*(x-midpoint)));
}
test('with random logistic data', () => {
  const MIDPOINT = 1000;
  const WIDTH = 300;
  const RATE = 1/WIDTH;

  const INDEX_PROB = 0.05;
  const MIN_INDEX = 1;
  const MAX_INDEX = 5000;
  const data: Array<[number, boolean]> = [];

  // do it this way instead of picking random indexes to avoid dupes
  for (let index = MIN_INDEX; index <= MAX_INDEX; index++) {
    if (Math.random() < INDEX_PROB) {
      data.push([
        index,
        Math.random() < logistic(index, MIDPOINT, RATE),
      ]);
    }
  }

  // add dummy elements to avoid failures
  data.push([0, true]);
  data.push([MAX_INDEX+1, false]);

  const result = indexRegression(data, 0.9);
  console.log({
    dataPoints: data.length,
    result,
  });
});
*/
