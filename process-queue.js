const debug = require('debug')('SimpleZSTDQueue');

class ProcessQueue {
  #poolOptions;

  #queue;

  #factory;

  #destroy;

  #isDestroyed;

  constructor(poolOptions, factory, destroy) {
    debug('constructor', poolOptions);
    this.#poolOptions = poolOptions || {};
    this.#queue = [];
    this.#factory = factory;
    this.#destroy = destroy;
    this.#isDestroyed = false;

    for (let i = 0; i < this.#poolOptions.targetSize || 0; i += 1) {
      this.#createResource();
    }
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
      setTimeout(() => {
        this.#createResource();
      }, 1);
      debug('acquire from queue');
      return this.#queue.pop();
    }
    debug('acquire create on demand');
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
