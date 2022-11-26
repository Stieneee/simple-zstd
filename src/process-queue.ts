import { PoolOpts } from "./types";
import stream from 'stream';

const debug = require('debug')('SimpleZSTDQueue');

export default class ProcessQueue {
  #targetSize;

  #queue: Array<Promise<stream.Duplex>>;

  #factory;

  #destroy;

  #hitCount;

  #missCount;

  constructor(targetSize: Number, factory: Function, destroy: Function) {
    debug('constructor', targetSize);
    this.#targetSize = targetSize;
    this.#queue = [];
    this.#factory = factory;
    this.#destroy = destroy;

    this.#hitCount = 0;
    this.#missCount = 0;

    for (let i = 0; i < targetSize || 0; i += 1) {
      this.#createResource();
    }
  }

  get hits() {
    return this.#hitCount;
  }

  get misses() {
    return this.#missCount;
  }

  async #createResource() {
    debug('createResource?', this.#queue.length);
    if (this.#queue.length < this.#targetSize ) {
      debug('createResource call factory');
      this.#queue.push(this.#factory());
    }
  }

  async acquire() {
    debug('acquire');
    if (this.#queue.length > 0) {
      setImmediate(() => {
        this.#createResource();
      });
      debug('acquire from queue');
      this.#hitCount += 1;
      return this.#queue.pop();
    }
    debug('acquire create on demand');
    this.#missCount += 1;
    return this.#factory();
  }

  async destroy() {
    debug('destroy', this.#queue.length);
    while (this.#queue.length > 0) {
      this.#destroy(this.#queue.pop());
    }
  }
}
