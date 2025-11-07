/// <reference types="chai" />
/// <reference types="mocha" />

declare namespace Chai {
  interface AssertStatic {
    fileEqual(path1: string, path2: string, callback?: () => void): void;
  }

  interface Assertion {
    rejected: Assertion;
    rejectedWith(expected: unknown, message?: string | RegExp): Assertion;
  }

  interface PromisedAssertion extends Assertion {
    rejected: PromisedAssertion;
    rejectedWith(expected: unknown, message?: string | RegExp): PromisedAssertion;
  }
}
