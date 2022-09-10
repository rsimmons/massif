import pickIndex from '../indexPicker';

test('empty data', () => {
  expect(pickIndex(0, 1000, [], 0.5)).toBe(500);
});

test('F', () => {
  expect(pickIndex(0, 1000, [
    [100, false],
  ], 0.5)).toBe(50);
});

test('T', () => {
  expect(pickIndex(0, 1000, [
    [100, true],
  ], 0.5)).toBe(550);
});

test('FF', () => {
  expect(pickIndex(0, 1000, [
    [100, false],
    [200, false],
  ], 0.5)).toBe(50);
});

test('TF', () => {
  expect(pickIndex(0, 1000, [
    [100, true],
    [200, false],
  ], 0.5)).toBe(150);
});

test('TT', () => {
  expect(pickIndex(0, 1000, [
    [100, true],
    [200, true],
  ], 0.5)).toBe(600);
});

test('TTFF', () => {
  expect(pickIndex(0, 1000, [
    [50, true],
    [200, true],
    [300, false],
    [900, false],
  ], 0.5)).toBe(250);
});

test('TTF', () => {
  expect(pickIndex(0, 1000, [
    [100, true],
    [600, true],
    [800, false],
  ], 0.5)).toBe(700);
});

test('TFF', () => {
  expect(pickIndex(0, 1000, [
    [100, true],
    [300, false],
    [900, false],
  ], 0.5)).toBe(200);
});

test('FT', () => {
  expect(pickIndex(0, 1000, [
    [100, false],
    [200, true],
  ], 0.5)).toBe(150);
});

test('FFTT', () => {
  expect(pickIndex(0, 1000, [
    [100, false],
    [200, false],
    [300, true],
    [400, true],
  ], 0.5)).toBe(250);
});

test('TTFFFFFF', () => {
  expect(pickIndex(0, 1000, [
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
  expect(pickIndex(0, 1000, [
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
  expect(pickIndex(0, 1000, [
    [100, true],
    [400, false],
    [500, true],
    [520, false],
  ], 0.5)).toBe(450);
});

test('FFT', () => {
  const data: Array<[number, boolean]> = [
    [400, false], // across this item the curves cross
    [500, false],
    [600, true],
  ];

  // Because the curves cross across an item (cmp from 1 to -1), we take the
  // midpoint with prev/next item depending on whether the cross point is
  // "above" or "below" the index. Changing the probability will bias this.
  expect(pickIndex(0, 1000, data, 0.5)).toBe(450);
  expect(pickIndex(0, 1000, data, 0.7)).toBe(200);

  // With a low enough probability, it will bias towards taking the midpoint
  // of the last data and the highIndex
  expect(pickIndex(0, 1000, data, 0.1)).toBe(800);
});

test('FFFTTT', () => {
  expect(pickIndex(0, 1000, [
    [200, false],
    // here it's 50% known below and 50% unknown above (incl. dummies)
    [400, false],
    [500, false],
    // here it's 50% known below and 50% unknown above (incl. dummies)
    [600, true],
    [700, true],
    // here it's 50% known below and 50% unknown above (incl. dummies)
    [800, true],
  ], 0.5)).toBe(525); // midpoint of the min/max of the midpoint above: [300, 750]
});

test('TTTFTFFF', () => {
  const data: Array<[number, boolean]> = [
    [100, true],
    [500, true],
    [600, true],
    [700, false],
    // here it's 80% known below and 80% unknown above (incl. dummies)
    [1000, true],
    [1100, false],
    [1300, false],
    [1900, false],
  ];

  expect(pickIndex(0, 2000, data, 0.5)).toBe(850);

  // It should work regardless of order
  data.reverse();
  expect(pickIndex(0, 2000, data, 0.5)).toBe(850);
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
    expect(pickIndex(0, 10000, data, 0.001)).toBeDefined();
    expect(pickIndex(0, 10000, data, 0.2)).toBeDefined();
    expect(pickIndex(0, 10000, data, 0.5)).toBeDefined();
    expect(pickIndex(0, 10000, data, 0.8)).toBeDefined();
    expect(pickIndex(0, 10000, data, 0.999)).toBeDefined();
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
  const MIN_INDEX = 0;
  const MAX_INDEX = 5000;
  const data: Array<[number, boolean]> = [];

  // do it this way instead of picking random indexes to avoid dupes
  for (let index = MIN_INDEX+1; index < MAX_INDEX; index++) {
    if (Math.random() < INDEX_PROB) {
      data.push([
        index,
        Math.random() < logistic(index, MIDPOINT, RATE),
      ]);
    }
  }

  const result = pickIndex(MIN_INDEX, MAX_INDEX, data, 0.9);
  console.log({
    dataPoints: data.length,
    result,
  });
});
*/
