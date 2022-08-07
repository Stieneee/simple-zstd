const { Writable } = require('node:stream');

class BufferWritable extends Writable {
  #buf;

  constructor(options) {
    super(options);
    this.#buf = [];
    this.buffer = null;
  }

  _write(chunk, encoding, callback) {
    this.#buf.push(chunk);
    callback();
  }

  _final(callback) {
    this.buffer = Buffer.concat(this.#buf);
    callback();
  }
}

module.exports = BufferWritable;
