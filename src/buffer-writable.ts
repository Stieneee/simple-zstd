import { Writable } from 'stream';

export default class BufferWritable extends Writable {
  #buf: Array<Buffer>;

  constructor(options: Object) {
    super(options);
    this.#buf = [];
  }

  _write(chunk: Buffer, encoding: string, callback: Function = () => {}) {
    this.#buf.push(chunk);
    callback();
  }

  _writev(chunks: Array<{ chunk: Buffer, encoding: string }>, callback: Function = () => {}) {
    for (const { chunk } of chunks) {
      this.#buf.push(chunk);
    }
    callback();
  }

  _final(callback: Function = () => {}) {
    callback();
  }

  getBuffer(): Buffer {
    return Buffer.concat(this.#buf) || Buffer.alloc(0);
  }
}
