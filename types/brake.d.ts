declare module 'brake' {
  import { Transform } from 'stream';

  function brake(bytesPerSecond: number): Transform;
  export = brake;
}
