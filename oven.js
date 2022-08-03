const debug = require('debug')('SimpleZSTDOven');

class Oven {
  #poolOptions;

  #queue;

  #factory;

  #destroy;

  constructor(poolOptions, factory, destroy) {
    debug('constructor', poolOptions);
    this.#poolOptions = poolOptions || {};
    this.#queue = [];
    this.#factory = factory;
    this.#destroy = destroy;

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
    while (this.#queue.length > 0) {
      this.#destroy(this.#queue.pop());
    }
  }
}

module.exports = Oven;
