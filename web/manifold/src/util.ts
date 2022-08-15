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
