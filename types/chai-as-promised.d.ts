/// <reference types="chai" />

declare module 'chai-as-promised' {
  function chaiAsPromised(chai: Chai.ChaiStatic, utils: unknown): void;
  namespace chaiAsPromised {}
  export = chaiAsPromised;
}

declare namespace Chai {
  interface Assertion {
    rejected: Assertion;
    rejectedWith(expected: unknown, message?: string | RegExp): Assertion;
  }

  interface PromisedAssertion extends Assertion {
    rejected: PromisedAssertion;
    rejectedWith(expected: unknown, message?: string | RegExp): PromisedAssertion;
  }
}
