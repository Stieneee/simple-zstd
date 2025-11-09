// This is a generic class for creating a queue of worker processes.

import Debug from 'debug';

const debug = Debug('SimpleZSTDQueue');

export default class ProcessQueue<QueueItem> {
  #targetSize;

  #queue: Array<Promise<QueueItem>>;

  #factory: () => Promise<QueueItem>;

  #destroy: (process: Promise<QueueItem>) => void;

  #hitCount;

  #missCount;

  constructor(targetSize: number, factory: () => Promise<QueueItem>, destroy: (process: Promise<QueueItem>) => void) {
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

  async acquire(): Promise<QueueItem> {
    debug('acquire');
    const attempt = this.#queue.pop();

    if (attempt) {
      debug('acquire hit');
      setImmediate(() => {
        this.#createResource();
      });
      this.#hitCount += 1;
      return attempt;
    }

    debug('acquire miss');
    this.#missCount += 1;
    return this.#factory();
  }

  async destroy() {
    debug('destroy', this.#queue.length);
    const destroyPromises: Promise<void>[] = [];
    while (this.#queue.length > 0) {
      const p = this.#queue.pop();
      if (p) {
        destroyPromises.push(Promise.resolve(this.#destroy(p)));
      }
    }
    await Promise.all(destroyPromises);
  }
}
