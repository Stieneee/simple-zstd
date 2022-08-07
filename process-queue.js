const debug = require('debug')('SimpleZSTDQueue');

class ProcessQueue {
  #poolOptions;

  #queue;

  #factory;

  #destroy;

  #isDestroyed;

  #hitCount;

  #missCount;

  constructor(poolOptions, factory, destroy) {
    debug('constructor', poolOptions);
    this.#poolOptions = poolOptions || {};
    this.#queue = [];
    this.#factory = factory;
    this.#destroy = destroy;
    this.#isDestroyed = false;

    this.#hitCount = 0;
    this.#missCount = 0;

    for (let i = 0; i < this.#poolOptions.targetSize || 0; i += 1) {
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
    if (this.#queue.length < this.#poolOptions.targetSize) {
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
    this.#isDestroyed = true;
    while (this.#queue.length > 0) {
      this.#destroy(this.#queue.pop());
    }
  }
}

module.exports = ProcessQueue;
