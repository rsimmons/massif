import { assert } from 'console';
import {invariant, cmp} from './util';

/**
 * This function implements an algorithm that is used for estimating a user's
 * knowledge of word that we haven't tested them on yet. It assumes that we
 * have tested them on words in an ordering that goes from easy/common at
 * low indexes to hard/rare at higher indexes. It takes as input an array
 * of [index, doesUserKnow], and a target probability of knowing, and returns
 * an index at which they should have approximately that probability of
 * knowing another (unseen) word.
 *
 * Another approach to this would be binary logisitc regression. I found that
 * logistic regression had problems convering when the data was sparse or
 * unusual. This gives a similar result while being more direct/simple/robust.
 * Unlike logistic regression, it doesn't assume a specific curve prior,
 * so it can't extraploate outisde the range of seen indexes (and can't even
 * smoothly interpolate _between_ seen indexes). Tt's not clear to me that
 * assuming a logistic curve over indexes is warranted as a prior anyway.
 *
 * Very small data sets are likely to fail to find an index. But if "dummy"
 * elements are added, one known at an index below the lowest, and one unknown
 * at an index above the highest, then the algorithm is guaranteed to find
 * an index (see test for this).
 *
 * The algorithm is described in terms of "indexes", but it would work the same
 * for any independent variable even if negative or non-integer.
 */

export default function indexRegression(
  data: ReadonlyArray<[number, boolean]>, // array of [index, known]
  probability: number, // probability of knowing we want to find index for
): number | undefined { // returns the estimated index or undefined if can't be found
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

  if (data.length === 0) {
    return undefined;
  }

  // sort by index
  const sortedData = [...data];
  sortedData.sort(([idxA, ], [idxB, ]) => idxA - idxB);

  assert((probability > 0) && (probability < 1));
  const unknownWeight = probability/(1 - probability);

  // do first pass to find total known count
  let countKnown = 0;
  for (const [, known] of sortedData) {
    if (known) {
      countKnown++;
    }
  }
  const countTotal = sortedData.length;

  // do the main pass where we try to find crossover point
  let knownBelow = 0;
  let prevCmp = undefined;
  const crossIndexes: Array<number> = [];
  // console.log({
  //   sortedData,
  //   countKnown,
  //   countTotal,
  //   unknownWeight,
  // });

  for (let i = 0; i < countTotal; i++) {
    const [index, known] = sortedData[i];

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
    if (
      ((prevCmp === 1) && (curCmp === -1)) ||
      ((prevCmp === 1) && (curCmp === 0)) ||
      ((prevCmp === 0) && (curCmp === -1))
    ) {
      // console.log('added to indexes');
      crossIndexes.push(index);
    }

    prevCmp = curCmp;
  }

  // console.log({
  //   crossIndexes,
  // });
  if (crossIndexes.length === 0) {
    return undefined;
  } else {
    return Math.floor(0.5*(crossIndexes[0] + crossIndexes[crossIndexes.length-1]));
  }
}
