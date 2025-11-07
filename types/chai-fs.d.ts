/// <reference types="chai" />

declare module 'chai-fs' {
  function chaiFsPlugin(chai: Chai.ChaiStatic, utils: unknown): void;
  namespace chaiFsPlugin {}
  export = chaiFsPlugin;
}

declare namespace Chai {
  interface AssertStatic {
    fileEqual(path1: string, path2: string, callback?: () => void): void;
  }
}
