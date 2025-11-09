declare module 'brake' {
  import { Transform } from 'node:stream';

  function brake(bytesPerSecond: number): Transform;

  export = brake;
}
