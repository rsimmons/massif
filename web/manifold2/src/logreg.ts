import { invariant } from "./util";

export interface FitResult {
  readonly b: number; // bias
  readonly w: number; // weight
}

function logistic(x: number, b: number, w: number) {
  return 1/(1 + Math.exp(-(b + w*x)));
}

// binary, single independent variable
// data is [x, y] where y must be 0 or 1
// uses gradient descent
// gaussian/L2 regularization with strength given by `reg` (if 0, no regularization is done)
export function fit(data: ReadonlyArray<[number, number]>, reg: number, learnRate: number, iters: number): FitResult {
  invariant(data.length > 0);
  invariant(data.every(([, y]) => ((y === 0) || (y === 1))));

  const invDataLen = 1/data.length;

  let b = 0;
  let w = 0;
  for (let iter = 0; iter < iters; iter++) {
    // console.log('STARTING ITER', iter);

    let dB = 0; // partial deriv of loss wrt b
    let dW = 0; // partial deriv of loss wrt w
    let loss = 0;

    for (const [x, y] of data) {
      const pred = logistic(x, b, w);
      const err = pred - y;
      dB += err;
      dW += err*x;
      loss += y ? -Math.log(pred) : -Math.log(1-pred);
      // console.log('DATA POINT', {
      //   x,
      //   y,
      //   pred,
      //   err,
      //   'err*x': err*x,
      //   loss,
      // });
    }
    dB *= invDataLen;
    dW *= invDataLen;
    loss *= invDataLen;

    // L2 regularization. the derivative turns out to be very simple
    // NOTE: we don't need to regularize the bias, since that can't blow up.
    // I confirmed this is the same behavior as scikit-learn LogisticRegression
    dW += 2*reg*w;

    b -= learnRate*dB;
    w -= learnRate*dW;

    // console.log('FINISHED ITER', {
    //   dB,
    //   dW,
    //   loss,
    //   b,
    //   w,
    // });
  }

  return {
    b,
    w,
  };
}

// first rescales x's to [-1, 1]
export function rescaleAndFit(data: ReadonlyArray<[number, number]>, reg: number, learnRate: number, iters: number): FitResult {
  invariant(data.length >= 2);

  let min = Infinity;
  let max = -Infinity;
  for (const [x, ] of data) {
    if (x < min) {
      min = x;
    }
    if (x > max) {
      max = x;
    }
  }

  invariant(min !== max);

  const invWidth = 1/(max - min);
  const A = 2*invWidth;
  const B = -2*min*invWidth - 1;
  const rescaledData: ReadonlyArray<[number, number]> = data.map(([x, y]) => [A*x + B, y]);

  const rfit = fit(rescaledData, reg, learnRate, iters);

  // convert w, b parameters from rescaled space back to initial space (algebra)
  return {
    b: rfit.b + B*rfit.w,
    w: A*rfit.w,
  };
}

export function findXGivenProb(fr: FitResult, prob: number): number {
  const logit = Math.log(prob/(1-prob));
  return (logit - fr.b)/fr.w;
}
