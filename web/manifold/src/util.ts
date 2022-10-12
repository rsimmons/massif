export class InvariantError extends Error {
  constructor(m?: string) {
    super(m);
    Object.setPrototypeOf(this, InvariantError.prototype);
  }
}

export function invariant(condition: any, msg?: string): asserts condition {
  if (!condition) {
    throw new InvariantError(msg);
  }
}

export class UnreachableCaseError extends Error {
  constructor(value: never) {
    super(`Unreachable case: ${value}`);
  }
}

export function getUnixTime(): number {
  return Math.floor(0.001*Date.now());
}

export function randomChoice<T>(arr: ReadonlyArray<T>): T {
  if (arr.length < 1) {
    throw new Error();
  }
  return arr[Math.floor(Math.random() * arr.length)];
}

function genRandomStr32(): string {
  return Math.random().toString(16).substring(2, 10);
}
export function genRandomStr64(): string {
  return genRandomStr32() + genRandomStr32();
}

export function cmp(a: number, b: number): -1|0|1 {
  if (a < b) {
    return -1;
  } else if (a > b) {
    return 1;
  } else {
    return 0;
  }
}

export function humanTime(t: number) {
  invariant(t >= 0, 'humanTime: time must be non-negative');

  if (t === 0) {
    return '0s';
  } else if (t < 1) {
    return '<1s';
  } else if (t < 60) {
    return `${Math.round(t)}s`;
  } else if (t < 3600) {
    return `${Math.round(t/60)}m`;
  } else {
    return `${Math.round(t/3600)}h`;
  }
}
