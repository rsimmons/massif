import { invariant } from "./util";

export interface IRTConfig {
  readonly wordRankToDifficulty: (rank: number) => number;
  readonly difficultyToWordRank: (diff: number) => number;

  // Discrimination/slope for all items (single parameter model).
  // A higher value means a given difference between ability and difficulty
  // gives a more dramatic difference in probability.
  readonly itemDiscrim: number;

  readonly abilityPrior: {
    readonly mean: number;
    readonly stddev: number;

    // used by EAP and MLE
    readonly min: number;
    readonly max: number;
    readonly samplePoints: number;
  },

  readonly mleClimbIters: number;
  readonly confidenceDelta: number; // compare likelihood at ability +/- this amt
}

function sqr(x: number): number {
  return x*x;
}

const ONE_OVER_ROOT_TWO_PI = 1.0/Math.sqrt(2*Math.PI);
function normalPDF(x: number, mean: number, stddev: number): number {
  const inv_stddev = 1.0/stddev;
  return inv_stddev*ONE_OVER_ROOT_TWO_PI*Math.exp(-0.5*sqr(inv_stddev*(x-mean)));
}

// item response function
function itemResponseFunction(difficulty: number, ability: number, discrim: number) {
  return 1.0/(1.0 + Math.exp(discrim*(difficulty - ability)));
}

function likelihood(data: ReadonlyArray<[number, boolean]>, ability: number, config: IRTConfig): number {
  let l = 1;
  for (const [rank, known] of data) {
    const difficulty = config.wordRankToDifficulty(rank); // TODO: this could be moved out of this inner loop
    const irf = itemResponseFunction(difficulty, ability, config.itemDiscrim);
    l *= known ? irf : (1 - irf);
  }
  return l;
}

// based on https://github.com/geekie/irt-js/tree/master/src
// Estimate the word difficulty at which the user has even odds of knowing/not-knowing
// an unseen word using EAP algorithm (uses prior distribution of user ability).
function estimateUserEvenAbilityEAP(data: ReadonlyArray<[number, boolean]>, config: IRTConfig): number {
  // this bit can be pre-computed
  const priorPDF: Array<[number, number]> = [];
  const step = (config.abilityPrior.max - config.abilityPrior.min)/(config.abilityPrior.samplePoints - 1);
  for (let ab = config.abilityPrior.min; ab <= config.abilityPrior.max; ab += step) {
    priorPDF.push([ab, normalPDF(ab, config.abilityPrior.mean, config.abilityPrior.stddev)]);
  }

  let num = 0;
  let denom = 0;
  for (const [ability, prob] of priorPDF) {
    const like = likelihood(data, ability, config);
    num += ability*like*prob;
    denom += like*prob;
  }

  return num/denom;
}

// Estimate the word difficulty at which the user has even odds of knowing/not-knowing
// an unseen word using MLE algorithm (requires at least one pos and one neg data point).
function estimateUserEvenAbilityMLE(data: ReadonlyArray<[number, boolean]>, config: IRTConfig): number {
  // sample likelihood at a number of ability values, to get started
  const step = (config.abilityPrior.max - config.abilityPrior.min)/(config.abilityPrior.samplePoints - 1);
  let maxLikeVal = undefined;
  let maxLikeAbility = undefined;
  for (let ab = config.abilityPrior.min; ab <= config.abilityPrior.max; ab += step) {
    const like = likelihood(data, ab, config);
    if ((maxLikeVal === undefined) || (like > maxLikeVal)) {
      maxLikeVal = like;
      maxLikeAbility = ab;
    }
  }
  invariant(maxLikeAbility !== undefined);
  invariant(maxLikeVal !== undefined);

  // hill climb a bit to refine
  let climbStep = 0.5*step;
  for (let i = 0; i < config.mleClimbIters; i++) {
    const upAb: number = maxLikeAbility + climbStep;
    const upLike = likelihood(data, upAb, config);
    if (upLike > maxLikeVal) {
      maxLikeVal = upLike;
      maxLikeAbility = upAb;
    } else {
      const downAb: number = maxLikeAbility - climbStep;
      const downLike = likelihood(data, downAb, config);
      if (downLike > maxLikeVal) {
        maxLikeVal = downLike;
        maxLikeAbility = downAb;
      }
    }

    climbStep *= 0.5;
  }

  return maxLikeAbility;
}

export function estimateUserRank(data: ReadonlyArray<[number, boolean]>, config: IRTConfig): number {
  let knownCount = 0;
  let unknownCount = 0;
  for (const [, known] of data) {
    if (known) {
      knownCount++;
    } else {
      unknownCount++;
    }
  }

  // if we have at least one each known and unknown we can use MLE, otherwise
  // we must rely on an ability prior and use EAP (MLE would not converge)
  // const ability = ((knownCount > 0) && (unknownCount > 0)) ?
  //   estimateUserEvenAbilityMLE(data, config) :
  //   estimateUserEvenAbilityEAP(data, config);

  const ability = estimateUserEvenAbilityEAP(data, config);
  console.log('EAP estimate', config.difficultyToWordRank(ability), 'MLE estimate', config.difficultyToWordRank(estimateUserEvenAbilityMLE(data, config)));

  const debugLike = [];
  const step = (config.abilityPrior.max - config.abilityPrior.min)/(100 - 1);
  for (let ab = config.abilityPrior.min; ab <= config.abilityPrior.max; ab += step) {
    debugLike.push([ab, likelihood(data, ab, config)]);
  }
  // console.log(debugLike);

  const peakLike = likelihood(data, ability, config);
  const drop = Math.min(
    peakLike/likelihood(data, ability+config.confidenceDelta, config),
    peakLike/likelihood(data, ability-config.confidenceDelta, config),
  );
  // console.log('drop ratio is', drop);

  return Math.round(config.difficultyToWordRank(ability));
}
