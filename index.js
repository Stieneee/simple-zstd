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

const Oven = require('./oven');
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
  if (!lvl) lvl = 3;
  if (lvl < 1 || lvl > 22) lvl = 3;

  // Dictionary
  let dCleanup = null;
  if (dictionary && dictionary.path) {
    opts = [...opts, '-D', `${dictionary.path}`]; //eslint-disable-line
  } else if (Buffer.isBuffer(dictionary)) {
    const { path, cleanup } = await file();
    dCleanup = cleanup;
    await writeFile(path, dictionary);
    opts = [...opts, '-D', `${path}`]; //eslint-disable-line
  }

  let c;

  try {
    debug(bin, ['-c', `-l${lvl}`, ...opts], spawnOptions, streamOptions);
    c = ps.spawn(bin, [`-${lvl}`, ...opts], spawnOptions, streamOptions);
  } catch (err) {
    // cleanup if error;
    if (dCleanup) dCleanup();
    throw err;
  }

  c.on('exit', (code, signal) => {
    debug('exit', code, signal);
    if (code !== 0) {
      setTimeout(() => {
        c.destroy(new Error(`zstd exited non zero. code: ${code} signal: ${signal}`));
      }, 1);
    }
    if (dCleanup) dCleanup();
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
  let dCleanup = null;
  if (dictionary && dictionary.path) {
    opts = [...opts, '-D', `${dictionary.path}`]; //eslint-disable-line
  } else if (Buffer.isBuffer(dictionary)) {
    const { path, cleanup } = await file();
    dCleanup = cleanup;
    await writeFile(path, dictionary);
    opts = [...opts, '-D', `${path}`]; //eslint-disable-line
  }

  let d;

  try {
    debug(bin, ['-d', ...opts], spawnOptions, streamOptions);
    d = ps.spawn(bin, ['-d', ...opts], spawnOptions, streamOptions);
  } catch (err) {
    // cleanup if error
    if (dCleanup) dCleanup();
    throw err;
  }

  d.on('exit', (code, signal) => {
    debug('exit', code, signal);
    if (code !== 0) {
      setTimeout(() => {
        d.destroy(new Error(`zstd exited non zero. code: ${code} signal: ${signal}`));
      }, 1);
    }
    if (dCleanup) dCleanup();
  });

  return peek({ newline: false, maxBuffer: 10 }, (data, swap) => {
    if (isZst(data)) return swap(null, d);
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
  #compressOven;

  #decompressOven;

  #bufferFileCleanup;

  #ready;

  constructor(poolOptions, compLevel, spawnOptions, streamOptions, zstdOptions, dictionary) {
    // Use a guard in all function to complete the async dictionary loading
    debug('constructor', poolOptions, compLevel, spawnOptions, streamOptions, zstdOptions, dictionary);
    const poolOpts = poolOptions || {};
    this.#ready = new Promise(async (resolve, reject) => {
      let path = null;
      let cleanup = null;

      try {
        if (dictionary) {
          ({ path, cleanup } = await file());
          this.#bufferFileCleanup = cleanup;
          await writeFile(path, dictionary);
        }

        this.#compressOven = new Oven(
          poolOpts.compressQueueSize,
          (() => {
            debug('compress factory');
            return CreateDecompressStream(compLevel, spawnOptions, streamOptions, zstdOptions, { path });
          }),
          async (p) => {
            debug('compress cleanup');
            (await p).kill();
          },
        );

        this.#decompressOven = new Oven(
          poolOpts.decompressQueueSize,
          (() => {
            debug('decompress factory');
            return CreateDecompressStream(compLevel, spawnOptions, streamOptions, zstdOptions, { path });
          }),
          async (p) => {
            debug('decompress cleanup');
            (await p).kill();
          },
        );

        debug('READY');
        resolve();
      } catch (err) {
        if (cleanup) cleanup();
        reject(err);
      }
    }).catch((err) => {
      debug('ready error', err);
      this.cleanup();
    });
  }

  destroy() {
    this.#compressOven.destroy();
    this.#decompressOven.destroy();
    if (this.#bufferFileCleanup) this.#bufferFileCleanup();
  }

  async compress() {
    await this.#ready;
    return this.#compressOven.acquire();
  }

  async compressBuffer(buffer) {
    await this.#ready;
    const c = await this.#compressOven.acquire();
    return CompressBuffer(buffer, c);
  }

  async decompress() {
    await this.#ready;
    return this.#decompressOven.acquire();
  }

  async decompressBuffer(buffer) {
    await this.#ready;
    const d = await this.#decompressOven.acquire();
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
