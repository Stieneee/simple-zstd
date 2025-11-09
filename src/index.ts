import fs from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { Readable, Duplex, PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execSync } from 'node:child_process';

import isZst from 'is-zst';
import {file} from 'tmp-promise';
import Debug from 'debug';

const debug = Debug('SimpleZSTD');

import ProcessQueue from './process-queue';
import BufferWritable from './buffer-writable';
import ProcessDuplex from './process-duplex';
import PeekPassThrough from './peek-transform';
import { ZSTDOpts, PoolOpts, DictionaryObject } from './types';

const find = (process.platform === 'win32') ? 'where zstd.exe' : 'which zstd';

let bin: string;

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

async function CreateCompressStream(compLevel: number, opts: ZSTDOpts): Promise<Duplex> {
  let lvl = compLevel;
  let zo = opts.zstdOptions || [];
  let path = null;
  let cleanup: () => void = () => null;

  if (!lvl) lvl = 3;
  if (lvl < 1 || lvl > 22) lvl = 3;

  // Dictionary
  if (opts.dictionary && 'path' in opts.dictionary) {
    zo = [...zo, '-D', `${opts.dictionary?.path}`]; //eslint-disable-line
  } else if (Buffer.isBuffer(opts.dictionary)) {
    ({ path, cleanup } = await file());
    await writeFile(path, opts.dictionary);
    zo = [...zo, '-D', `${path}`]; //eslint-disable-line
  }

  let c: Duplex;

  try {
    debug(bin, ['-zc', `-${lvl}`, ...zo], opts.spawnOptions, opts.streamOptions);
    c = new ProcessDuplex(bin, ['-zc', `-${lvl}`, ...zo], opts.spawnOptions, opts.streamOptions);
  } catch (err) {
    // cleanup if error;
    cleanup();
    throw err;
  }

  c.on('exit', (code: number, signal) => {
    debug('c exit', code, signal);
    if (code !== 0) {
      setTimeout(() => {
        c.destroy(new Error(`zstd exited non zero. code: ${code} signal: ${signal}`));
      }, 1);
    }
    cleanup();
  });

  return c;
}

function CompressBuffer(buffer: Buffer, c: Duplex): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const w = new BufferWritable({});

    pipeline(
      Readable.from(buffer),
      c,
      w,
    )
      .then(() => {
        c.destroy();
        resolve(w.getBuffer());
      })
      .catch((err: Error) => {
        c.destroy();
        reject(err);
      });
  });
}

async function CreateDecompressStream(opts: ZSTDOpts): Promise<Duplex> {
  // Dictionary
  let zo = opts.zstdOptions || [];
  let path = null;
  let cleanup: () => void = () => null;

  let terminate = false;

  if (opts.dictionary && 'path' in opts.dictionary) {
    zo = [...zo, '-D', `${opts.dictionary.path}`]; //eslint-disable-line
  } else if (Buffer.isBuffer(opts.dictionary)) {
    ({ path, cleanup } = await file());
    await writeFile(path, opts.dictionary);
    zo = [...zo, '-D', `${path}`]; //eslint-disable-line
  }

  let d: Duplex;

  try {
    debug(bin, ['-dc', ...zo], opts.spawnOptions, opts.streamOptions);
    d = new ProcessDuplex(bin, ['-dc', ...zo], opts.spawnOptions, opts.streamOptions);
  } catch (err) {
    // cleanup if error
    cleanup();
    throw err;
  }

  d.on('exit', (code: number, signal) => {
    debug('d exit', code, signal);
    if (code !== 0 && !terminate) {
      setTimeout(() => {
        d.destroy(new Error(`zstd exited non zero. code: ${code} signal: ${signal}`));
      }, 1);
    }
    cleanup();
  });

  return new PeekPassThrough({ maxBuffer: 10 }, (data: Buffer, swap) => {
    if (isZst(data)) {
      swap(null, d);
    } else {
      debug('not zstd');
      terminate = true;
      d.end();
      swap(null, new PassThrough());
    }
  });
}

function DecompressBuffer(buffer: Buffer, d: Duplex): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const w = new BufferWritable({});

    pipeline(
      Readable.from(buffer),
      d,
      w,
    )
      .then(() => {
        d.destroy();
        resolve(w.getBuffer() || Buffer.alloc(0));
      })
      .catch((err: Error) => {
        d.destroy();
        reject(err);
      });
  });
}

// Standalone Functions

export function compress(compLevel: number, opts: ZSTDOpts = {}): Promise<Duplex> {
  return CreateCompressStream(compLevel, opts);
}

export async function compressBuffer(buffer: Buffer, compLevel: number, opts: ZSTDOpts = {}): Promise<Buffer> {
  const c = await CreateCompressStream(compLevel, opts);
  return CompressBuffer(buffer, c);
}

export function decompress(opts: ZSTDOpts = {}): Promise<Duplex> {
  return CreateDecompressStream(opts);
}

export async function decompressBuffer(buffer: Buffer, opts: ZSTDOpts = {}): Promise<Buffer> {
  const d = await CreateDecompressStream(opts);
  return DecompressBuffer(buffer, d);
}

// SimpleZSTD Class
export class SimpleZSTD {
  #compressQueue!: ProcessQueue<Duplex>;
  #decompressQueue!: ProcessQueue<Duplex>;
  #bufferFileCleanup: () => void = () => null;
  #ready;

  constructor(poolOptions?: PoolOpts, dictionary?: Buffer | DictionaryObject) {
    // Use a guard in all function to complete the async dictionary loading
    debug('constructor', poolOptions, dictionary);
    // po.compressQueue = po.compressQueue || {};
    // po.decompressQueue = po.decompressQueue || {};

    this.#bufferFileCleanup = () => null;

    this.#ready = new Promise(async (resolve, reject) => { // eslint-disable-line
      let path: string | null = null;
      let cleanup = null;

      try {
        // Convert buffer or dictionary.path to path
        if (dictionary && 'path' in dictionary) {
          path = dictionary.path;
        }
        if (dictionary && Buffer.isBuffer(dictionary)) {
          ({ path, cleanup } = await file());
          this.#bufferFileCleanup = cleanup;
          await writeFile(path, dictionary);
        }

        this.#compressQueue = new ProcessQueue(
          poolOptions?.compressQueueSize || 0,
          (() => {
            debug('compress factory');
            return CreateCompressStream(
              poolOptions?.compressQueue?.compLevel || 3, 
              {
                ...poolOptions?.compressQueue,
                dictionary: path ? { path } : undefined,
              }
            );
          }),
          async (p: Promise<Duplex>) => {
            debug('compress cleanup');
            const stream = await p;
            stream.destroy();
          },
        );

        this.#decompressQueue = new ProcessQueue(
          poolOptions?.decompressQueueSize || 0,
          (() => {
            debug('decompress factory');
            return CreateDecompressStream({
              ...poolOptions?.decompressQueue,
              dictionary: path ? { path } : undefined,
            });
          }),
          async (p: Promise<Duplex>) => {
            debug('decompress cleanup');
            const stream = await p;
            stream.destroy();
          },
        );

        debug('READY');
        resolve(null);
      } catch (err) {
        reject(err);
      }
    }).catch((err) => {
      debug('ready error', err);
      this.#bufferFileCleanup();
      this.#bufferFileCleanup = () => null;
    });
  }

  get queueStats() {
    return {
      compress: {
        hits: this.#compressQueue.hits,
        misses: this.#compressQueue.misses,
      },
      decompress: {
        hits: this.#decompressQueue.hits,
        misses: this.#decompressQueue.misses,
      },
    };
  }

  destroy() {
    this.#compressQueue.destroy();
    this.#decompressQueue.destroy();
    this.#bufferFileCleanup();
    this.#bufferFileCleanup = () => null;
  }

  async compress(): Promise<Duplex> {
    await this.#ready;
    return this.#compressQueue.acquire();
  }

  async compressBuffer(buffer: Buffer): Promise<Buffer> {
    await this.#ready;
    const c = await this.#compressQueue.acquire();
    return CompressBuffer(buffer, c);
  }

  async decompress(): Promise<Duplex> {
    await this.#ready;
    return this.#decompressQueue.acquire();
  }

  async decompressBuffer(buffer: Buffer): Promise<Buffer> {
    await this.#ready;
    const d = await this.#decompressQueue.acquire();
    return DecompressBuffer(buffer, d);
  }
}

// module.exports = {
//   SimpleZSTD,
//   compress,
//   compressBuffer,
//   decompress,
//   decompressBuffer,
// };