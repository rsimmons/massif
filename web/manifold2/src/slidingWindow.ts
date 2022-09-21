import binomialTest from '@stdlib/stats-binomial-test'; // TODO: this adds 40k to the bundle, we should code our own
import { cmp, invariant } from './util';

console.log(binomialTest);

export interface FindRankResult {
  readonly windowBegin: number;
  readonly windowEnd: number;
  readonly confident: boolean;
}

// data is array of [rank, boolKnown] and we assume that rank is integer, >= 0
// note that we may return a window that begins at a negative rank
export function findRank(unsortedData: ReadonlyArray<[number, boolean]>, targetKnownFrac: number, windowSize: number, initRank: number): FindRankResult {
  // sort by index
  const data = [...unsortedData];
  data.sort(([rankA, ], [rankB, ]) => rankA - rankB);

  // don't allow the same rank to repeat, to simplify things
  for (let i = 0; i < (data.length-1); i++) {
    invariant(data[i][0] !== data[i+1][0]);
  }

  // wherever we have begin,end ranks, the end is not inclusive

  // returns [knownCount, totalCount]
  const getWindowCounts = (beginRank: number, endRank: number): [number, number] => {
    let knownCount = 0;
    let totalCount = 0;
    let beginIdx = 0;
    while ((beginIdx < data.length) && (data[beginIdx][0] < beginRank)) {
      beginIdx++;
    }
    let endIdx = beginIdx;
    while (endIdx < data.length) {
      const [rank, known] = data[endIdx];
      if (rank >= endRank) {
        break;
      }
      totalCount++;
      if (known) {
        knownCount++;
      }
      endIdx++;
    }
    return [knownCount, totalCount];
  };

  const halfWindowSize = Math.floor(0.5*windowSize);
  let windowBeginRank = initRank - halfWindowSize;
  let windowEndRank = initRank + halfWindowSize;

  while (true) {
    const [knownCount, totalCount] = getWindowCounts(windowBeginRank, windowEndRank);
    const windowKnownFrac = knownCount/totalCount;

    // check significance
    const P_THRESHOLD = 0.2;
    const btLess = binomialTest(knownCount, totalCount, {
      alpha: P_THRESHOLD,
      alternative: 'less',
      p: 0.4,
    });
    const btGreater = binomialTest(knownCount, totalCount, {
      alpha: P_THRESHOLD,
      alternative: 'greater',
      p: 0.6,
    });
    const signifClose = btLess.rejected && btGreater.rejected;
    console.log({
      windowBeginRank,
      windowEndRank,
      knownCount,
      totalCount,
      signifClose,
      btLess,
      btGreater,
    });

    if (signifClose) {
      return {
        windowBegin: windowBeginRank,
        windowEnd: windowEndRank,
        confident: true,
      };
    } else {
      if (totalCount < 1) {
        return {
          windowBegin: windowBeginRank,
          windowEnd: windowEndRank,
          confident: false,
        };
      } else {
        if (windowKnownFrac > targetKnownFrac) {
          const size = windowEndRank - windowBeginRank;
          windowBeginRank += size;
          windowEndRank += size;
        } else if (windowKnownFrac < targetKnownFrac) {
          if (windowBeginRank > 0) {
            const size = windowEndRank - windowBeginRank;
            windowBeginRank -= size;
            windowEndRank -= size;
          } else {
            windowEndRank = Math.floor(0.5*windowEndRank);
          }
        } else {
          return {
            windowBegin: windowBeginRank,
            windowEnd: windowEndRank,
            confident: false,
          };
        }
      }
    }
  }
}
