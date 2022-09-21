import { findXGivenProb, fit, rescaleAndFit } from '../logreg';

test('basic operation without regularization', () => {
  const fr = rescaleAndFit([
    [0, 1],
    [100, 1],
    [1000, 1],
    [5000, 1],
    [6000, 0],
    [7000, 1],
    [8000, 0],
    [19000, 0],
    [20000, 0],
  ], 0, 1, 10000);

  expect(fr.b).toBeCloseTo(6.313, 3);
  expect(fr.w).toBeCloseTo(-0.0009695, 7);
  expect(Math.round(findXGivenProb(fr, 0.5))).toBe(6511);
  expect(Math.round(findXGivenProb(fr, 0.9))).toBe(4245);
});

test('basic operation with regularization', () => {
  // these match the output of scikit-learn LogisticRegression if
  // its C parameter (inverse regularization strength) is set to 1

  const fr = fit([
    [-1, 1],
    [1, 0],
  ], 0.25, 1, 10000);

  expect(fr.b).toBeCloseTo(0, 5);
  expect(fr.w).toBeCloseTo(-0.67483, 5);

  // and with non-zero bias, to confirm that normalization isn't
  // applied to bias
  const fr2 = fit([
    [-1, 1],
    [2, 0],
  ], 0.25, 1, 10000);

  // this matches the output of scikit-learn LogisticRegression if
  // its C parameter (inverse regularization strength) is set to 1
  expect(fr2.b).toBeCloseTo(0.371, 3);
  expect(fr2.w).toBeCloseTo(-0.742, 3);
});
