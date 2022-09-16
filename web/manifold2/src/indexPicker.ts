import {invariant, cmp} from './util';

/**
 * This function implements an algorithm that is used for finding a word to
 * test a user on based on their knowledge of other words. It assumes that we
 * have tested them on words in an ordering that goes from easy/common at
 * low indexes to hard/rare at higher indexes. It takes as input:
 * - a "low" index that is lower than any in the data array
 * - a "high" index that is higher than any in the data array
 * - an array of [index, doesUserKnow]
 * - a target probability of knowing
 * It returns an index at which they should have approximately the given
 * probability of knowing another (unseen) word. It makes an effort to pick
 * an index that is at the midpoint of empty ranges between indexes.
 * The given low/high indexes are used in cases where we want to pick an index
 * below/above any of those in the given data points, it lets us know the
 * min/max allowed indexes.
 *
 * Another approach to this would be binary logisitc regression. I found that
 * logistic regression had problems convering when the data was sparse or
 * unusual. This gives a similar result while being more direct/simple/robust.
 * Unlike logistic regression, it doesn't assume a specific curve prior,
 * so it can't extraploate outisde the range of seen indexes (and can't even
 * smoothly interpolate _between_ seen indexes). Tt's not clear to me that
 * assuming a logistic curve over indexes is warranted as a prior anyway.
 *
 * The algorithm is described in terms of "indexes", but it would work the same
 * for any independent variable even if negative or non-integer.
 */

export default function pickIndex(
  lowIndex: number,
  highIndex: number,
  data: ReadonlyArray<[number, boolean]>, // array of [index, known]
  probability: number, // probability of knowing we want to find index for
): number { // returns the estimated index
  /**
   * For every point-between-indexes, we can compute what fraction below that
   * point are known (out of the total known and not-known), and what fraction
   * above that point are **not** known. The former should _usually_ be a
   * falling curve, and the latter a rising curve (though not strictly
   * monotonic in either case).
   *
   * As we move from one point to the next (across an _index_) those curves
   * may cross. The curves may cross at multiple indexes, in which case we
   * can find them all and take the midpoint of highest and lowest. That index
   * should be the index around which the user has a 50/50 chance of knowing
   * a word.
   *
   * To accomodate a target probability other than 0.5, we count the not-known
   * (false) data point as having a weight other than 1. E.g. to find the 75%
   * known point, we weight the not-known data points 3 to 1 vs. the known
   * data points, which generally will shift the result index lower.
   */

  // sort by index
  const sortedData = [...data];
  sortedData.sort(([idxA, ], [idxB, ]) => idxA - idxB);

  // sanity check that data indexes are inside low and high
  if (sortedData.length > 0) {
    invariant(sortedData[0][0] > lowIndex);
    invariant(sortedData[sortedData.length-1][0] < highIndex);
  }

  // Add dummy/padding elements to ensure algorithm succeeds and handle edges better
  const paddedData: ReadonlyArray<[number, boolean]> = [[lowIndex, true], ...sortedData, [highIndex, false]];

  invariant((probability > 0) && (probability < 1));
  const unknownWeight = probability/(1 - probability);

  // do first pass to find total known count
  let countKnown = 0;
  for (const [, known] of paddedData) {
    if (known) {
      countKnown++;
    }
  }
  const countTotal = paddedData.length;

  // do the main pass where we try to find crossover point
  let knownBelow = 0;
  let prevCmp = undefined;
  let prevFracs: undefined | [number, number | undefined] = undefined;
  const resultIndexes: Array<number> = [];
  // console.log({
  //   paddedData,
  //   countKnown,
  //   countTotal,
  //   unknownWeight,
  // });

  for (let i = 0; i < countTotal; i++) {
    const [index, known] = paddedData[i];

    // think of a point having just moved from before index i to after index i

    if (known) {
      knownBelow++;
    }

    // NOTE: we could move the multiplies out of the loop but this seems clearer and fast enough

    // compute fraction known below this point (after index i)
    const countBelow = i + 1;
    const unknownBelow = countBelow - knownBelow;
    const wgtCountBelow = knownBelow + unknownWeight*unknownBelow;
    const fracKnownBelow = knownBelow / wgtCountBelow;

    // compute fraction unknown above this point (after index i)
    const knownAbove = countKnown - knownBelow;
    const countAbove = countTotal - countBelow;
    const unknownAbove = countAbove - knownAbove;
    const wgtUnknownAbove = unknownWeight*unknownAbove;
    const wgtCountAbove = knownAbove + wgtUnknownAbove;
    const fracUnknownAbove = (countAbove === 0) ? undefined : (wgtUnknownAbove / wgtCountAbove);

    // compare fractions
    const curCmp = (fracUnknownAbove === undefined) ? undefined : cmp(fracKnownBelow, fracUnknownAbove);

    // console.log({
    //   i,
    //   index,
    //   knownBelow,
    //   unknownAbove,
    //   fracKnownBelow,
    //   fracUnknownAbove,
    //   prevCmp,
    //   curCmp,
    // });

    // did the fraction-curves cross in the "right"/expected direction?
    if (curCmp === 0) {
      invariant(i < (countTotal-1));
      const nextIndex = paddedData[i+1][0];
      resultIndexes.push(Math.round(0.5*(index + nextIndex)));
    } else if ((prevCmp === 1) && (curCmp === -1)) {

      invariant(prevFracs !== undefined);
      invariant(prevFracs[1] !== undefined);
      invariant(fracUnknownAbove !== undefined);
      const midFKB = 0.5*(fracKnownBelow + prevFracs[0]);
      const midFUA = 0.5*(fracUnknownAbove + prevFracs[1]);
      if (midFKB > midFUA) {
        invariant(i < (countTotal-1));
        const nextIndex = paddedData[i+1][0];
        resultIndexes.push(Math.round(0.5*(index + nextIndex)));
      } else if (midFKB < midFUA) {
        invariant(i > 0);
        const prevIndex = paddedData[i-1][0];
        resultIndexes.push(Math.round(0.5*(index + prevIndex)));
      } else {
        resultIndexes.push(index);
      }
    }

    prevCmp = curCmp;
    prevFracs = [fracKnownBelow, fracUnknownAbove];
  }

  invariant(resultIndexes.length > 0);
  // console.log({
  //   resultIndexes,
  // });
  return Math.round(0.5*(resultIndexes[0] + resultIndexes[resultIndexes.length-1]));
}
