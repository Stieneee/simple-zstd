const fs = require('node:fs');
const { writeFile } = require('node:fs/promises');
const { Readable, pipeline } = require('node:stream');
const util = require('node:util');

const ProcessStream = require('process-streams');
const { execSync } = require('node:child_process');
const isZst = require('is-zst');
const peek = require('peek-stream');
const through = require('through2');
const { file } = require('tmp-promise');
const debug = require('debug')('SimpleZSTD');

const ProcessQueue = require('./process-queue');
const BufferWritable = require('./buffer-writable');

const pipelineAsync = util.promisify(pipeline);

const find = (process.platform === 'win32') ? 'where zstd.exe' : 'which zstd';

let bin;

try {
  bin = execSync(find, { env: process.env }).toString().replace(/\n$/, '').replace(/\r$/, '');
  debug(bin);
} catch (err) {
  throw new Error('Can not access zstd! Is it installed?');
}

try {
  fs.accessSync(bin, fs.constants.X_OK);
} catch (err) {
  throw new Error('zstd is not executable');
}

async function CreateCompressStream(compLevel, spawnOptions, streamOptions, zstdOptions, dictionary) {
  const ps = new ProcessStream();

  let lvl = compLevel;
  let opts = zstdOptions || [];
  let path = null;
  let cleanup = null;

  if (!lvl) lvl = 3;
  if (lvl < 1 || lvl > 22) lvl = 3;

  // Dictionary
  if (dictionary && dictionary.path) {
    opts = [...opts, '-D', `${dictionary.path}`]; //eslint-disable-line
  } else if (Buffer.isBuffer(dictionary)) {
    ({ path, cleanup } = await file());
    await writeFile(path, dictionary);
    opts = [...opts, '-D', `${path}`]; //eslint-disable-line
  }

  let c;

  try {
    debug(bin, ['-c', `-l${lvl}`, ...opts], spawnOptions, streamOptions);
    c = ps.spawn(bin, [`-${lvl}`, ...opts], spawnOptions, streamOptions);
  } catch (err) {
    // cleanup if error;
    if (cleanup) cleanup();
    throw err;
  }

  c.on('exit', (code, signal) => {
    debug('c exit', code, signal);
    if (code !== 0) {
      setTimeout(() => {
        c.destroy(new Error(`zstd exited non zero. code: ${code} signal: ${signal}`));
      }, 1);
    }
    if (cleanup) cleanup();
  });

  return c;
}

function CompressBuffer(buffer, c) {
  return new Promise((resolve, reject) => {
    const w = new BufferWritable();

    pipelineAsync(
      Readable.from(buffer),
      c,
      w,
    )
      .then(() => resolve(w.buffer))
      .catch((err) => reject(err));
  });
}

async function CreateDecompressStream(spawnOptions, streamOptions, zstdOptions, dictionary) {
  // Dictionary
  const ps = new ProcessStream();

  let opts = zstdOptions || [];
  let path = null;
  let cleanup = null;

  let terminate;

  if (dictionary && dictionary.path) {
    opts = [...opts, '-D', `${dictionary.path}`]; //eslint-disable-line
  } else if (Buffer.isBuffer(dictionary)) {
    ({ path, cleanup } = await file());
    await writeFile(path, dictionary);
    opts = [...opts, '-D', `${path}`]; //eslint-disable-line
  }

  let d;

  try {
    debug(bin, ['-d', ...opts], spawnOptions, streamOptions);
    d = ps.spawn(bin, ['-d', ...opts], spawnOptions, streamOptions);
  } catch (err) {
    // cleanup if error
    if (cleanup) cleanup();
    throw err;
  }

  d.on('exit', (code, signal) => {
    debug('d exit', code, signal);
    if (code !== 0 && !terminate) {
      setTimeout(() => {
        d.destroy(new Error(`zstd exited non zero. code: ${code} signal: ${signal}`));
      }, 1);
    }
    if (cleanup) cleanup();
  });

  return peek({ newline: false, maxBuffer: 10 }, (data, swap) => {
    if (isZst(data)) return swap(null, d);
    debug('not zstd');
    terminate = true;
    d.end();
    return swap(null, through());
  });
}

function DecompressBuffer(buffer, d) {
  return new Promise((resolve, reject) => {
    const w = new BufferWritable();

    pipelineAsync(
      Readable.from(buffer),
      d,
      w,
    )
      .then(() => resolve(w.buffer))
      .catch((err) => reject(err));
  });
}

// Standalone Functions

function compress(compLevel, spawnOptions, streamOptions, zstdOptions, dictionary) {
  // Returns a promise
  return CreateCompressStream(compLevel, spawnOptions, streamOptions, zstdOptions, dictionary);
}

async function compressBuffer(buffer, compLevel, spawnOptions, streamOptions, zstdOptions, dictionary) {
  const c = await CreateCompressStream(compLevel, spawnOptions, streamOptions, zstdOptions, dictionary);
  return CompressBuffer(buffer, c);
}

function decompress(spawnOptions, streamOptions, zstdOptions, dictionary) {
  // Returns a promise
  return CreateDecompressStream(spawnOptions, streamOptions, zstdOptions, dictionary);
}

async function decompressBuffer(buffer, spawnOptions, streamOptions, zstdOptions, dictionary) {
  const d = await CreateDecompressStream(spawnOptions, streamOptions, zstdOptions, dictionary);
  return DecompressBuffer(buffer, d);
}

// SimpleZSTD Class
class SimpleZSTD {
  #compressQueue;

  #decompressQueue;

  #bufferFileCleanup;

  #ready;

  constructor(poolOptions, dictionary) {
    // Use a guard in all function to complete the async dictionary loading
    debug('constructor', poolOptions, dictionary);
    const poolOpts = poolOptions || {};
    poolOpts.compressQueue = poolOpts.compressQueue || {};
    poolOpts.decompressQueue = poolOpts.decompressQueue || {};

    this.#ready = new Promise(async (resolve, reject) => { // eslint-disable-line
      let path = null;
      let cleanup = null;

      try {
        // Convert buffer or dictionary.path to path
        if (dictionary && dictionary.path) {
          path = dictionary.path;
        }
        if (dictionary && Buffer.isBuffer(dictionary)) {
          ({ path, cleanup } = await file());
          this.#bufferFileCleanup = cleanup;
          await writeFile(path, dictionary);
        }

        this.#compressQueue = new ProcessQueue(
          poolOpts.compressQueue,
          (() => {
            debug('compress factory');
            return CreateCompressStream(poolOpts.compressQueue.compLevel, poolOpts.compressQueue.spawnOptions, poolOpts.compressQueue.streamOptions, poolOpts.compressQueue.zstdOptions, { path });
          }),
          async (p) => {
            debug('compress cleanup');
            (await p).end();
          },
        );

        this.#decompressQueue = new ProcessQueue(
          poolOpts.decompressQueue,
          (() => {
            debug('decompress factory');
            return CreateDecompressStream(poolOpts.decompressQueue.spawnOptions, poolOpts.decompressQueue.streamOptions, poolOpts.decompressQueue.zstdOptions, { path });
          }),
          async (p) => {
            debug('decompress cleanup');
            (await p).end('1234567890000');
          },
        );

        debug('READY');
        resolve();
      } catch (err) {
        reject(err);
      }
    }).catch((err) => {
      debug('ready error', err);
      if (this.#bufferFileCleanup) this.#bufferFileCleanup();
      this.#bufferFileCleanup = null;
    });
  }

  get queueStats() {
    return {
      compresss: {
        hits: this.#compressQueue.hits,
        misses: this.#compressQueue.misses,
      },
      decompresss: {
        hits: this.#decompressQueue.hits,
        misses: this.#decompressQueue.misses,
      },
    };
  }

  destroy() {
    this.#compressQueue.destroy();
    this.#decompressQueue.destroy();
    if (this.#bufferFileCleanup) this.#bufferFileCleanup();
    this.#bufferFileCleanup = null;
  }

  async compress() {
    await this.#ready;
    return this.#compressQueue.acquire();
  }

  async compressBuffer(buffer) {
    await this.#ready;
    const c = await this.#compressQueue.acquire();
    return CompressBuffer(buffer, c);
  }

  async decompress() {
    await this.#ready;
    return this.#decompressQueue.acquire();
  }

  async decompressBuffer(buffer) {
    await this.#ready;
    const d = await this.#decompressQueue.acquire();
    return DecompressBuffer(buffer, d);
  }
}

module.exports = {
  SimpleZSTD,
  compress,
  compressBuffer,
  decompress,
  decompressBuffer,
};
