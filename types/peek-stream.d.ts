declare module 'peek-stream' {
  import { Duplex } from 'stream';

  interface PeekOptions {
    newline?: boolean;
    maxBuffer?: number;
  }

  type SwapFunction = (err: Error | null, stream: Duplex) => void;
  type PeekCallback = (data: Buffer, swap: SwapFunction) => void;

  function peek(options: PeekOptions, callback: PeekCallback): Duplex;
  export = peek;
}
