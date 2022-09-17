import { estimateUserRank, IRTConfig } from '../irt';

const IRT_CONFIG: IRTConfig = {
  wordRankToDifficulty: (rank: number): number => Math.log(rank),
  difficultyToWordRank: (diff: number): number => Math.exp(diff),
  itemDiscrim: 1,
  abilityPrior: {
    mean: 7,
    stddev: 2,
    min: 0,
    max: 11,
    samplePoints: 30,
  },
  mleClimbIters: 20,
  confidenceDelta: 0.25,
};

test('manually', () => {
  // estimateUserRank([
  //   [1000, true],
  //   [4000, false],
  // ], IRT_CONFIG);

  // estimateUserRank([
  //   ...Array(5).fill([1000, true]),
  //   [4000, false],
  // ], IRT_CONFIG);

  // estimateUserRank([
  //   ...Array(10).fill([1000, true]),
  //   [4000, false],
  // ], IRT_CONFIG);

  estimateUserRank([
    ...Array(20).fill([1000, true]),
    ...Array(20).fill([4000, false]),
  ], IRT_CONFIG);

  estimateUserRank([
    ...Array(40).fill([1000, true]),
    ...Array(20).fill([4000, false]),
  ], IRT_CONFIG);

  estimateUserRank([
    ...Array(80).fill([1000, true]),
    ...Array(20).fill([4000, false]),
  ], IRT_CONFIG);
});
