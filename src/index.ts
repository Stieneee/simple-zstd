import fs from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Readable, Duplex, PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execSync } from 'node:child_process';

import isZst from 'is-zst';
import { file } from 'tmp-promise';
import Debug from 'debug';

const debug = Debug('SimpleZSTD');

import ProcessQueue from './process-queue';
import BufferWritable from './buffer-writable';
import ProcessDuplex from './process-duplex';
import PeekPassThrough from './peek-transform';
import { ZSTDOpts, PoolOpts } from './types';

// Export types for consumers
export type { ZSTDOpts, PoolOpts, CompressOpts, DecompressOpts, DictionaryObject } from './types';

// Dictionary cache to avoid recreating temp files for the same dictionary buffer
// Map: hash -> { path: string, cleanup: () => void, refCount: number }
const dictionaryCache = new Map<string, { path: string; cleanup: () => void; refCount: number }>();

function hashBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

async function getCachedDictionaryPath(
  dictionary: Buffer
): Promise<{ path: string; cleanup: () => void }> {
  const hash = hashBuffer(dictionary);

  let cached = dictionaryCache.get(hash);
  if (cached) {
    cached.refCount++;
    debug(`Dictionary cache hit: ${hash.slice(0, 8)}... (refCount: ${cached.refCount})`);
    return {
      path: cached.path,
      cleanup: () => {
        cached!.refCount--;
        debug(
          `Dictionary refCount decreased: ${hash.slice(0, 8)}... (refCount: ${cached!.refCount})`
        );
        // Don't call async cleanup here - it will be handled by clearDictionaryCache()
        // or when all references are released
      },
    };
  }

  debug(`Dictionary cache miss: ${hash.slice(0, 8)}... - creating temp file`);
  const { path, cleanup: tmpCleanup } = await file({ prefix: 'zstd-dict-' });
  await writeFile(path, dictionary);

  dictionaryCache.set(hash, {
    path,
    cleanup: tmpCleanup,
    refCount: 1,
  });

  return {
    path,
    cleanup: () => {
      const cached = dictionaryCache.get(hash);
      if (cached) {
        cached.refCount--;
        debug(
          `Dictionary refCount decreased: ${hash.slice(0, 8)}... (refCount: ${cached.refCount})`
        );
        // Don't call async cleanup here - it will be handled by clearDictionaryCache()
        // or when all references are released
      }
    },
  };
}

/**
 * Clear the dictionary cache and cleanup all temporary files
 * This is useful for testing or manual cache management
 * @returns Promise that resolves when all cleanups are complete
 */
export async function clearDictionaryCache(): Promise<void> {
  debug('Clearing dictionary cache');
  const cleanupPromises: Promise<void>[] = [];

  for (const [hash, cached] of dictionaryCache.entries()) {
    debug(`Cleaning up cached dictionary: ${hash.slice(0, 8)}...`);
    // tmp-promise cleanup() returns a Promise
    cleanupPromises.push(Promise.resolve(cached.cleanup()));
  }

  await Promise.all(cleanupPromises);
  dictionaryCache.clear();
}

const find = process.platform === 'win32' ? 'where zstd.exe' : 'which zstd';

let bin: string;

try {
  bin = execSync(find, { env: process.env }).toString().replace(/\n$/, '').replace(/\r$/, '');
  debug(bin);
} catch {
  throw new Error('Can not access zstd! Is it installed?');
}

try {
  fs.accessSync(bin, fs.constants.X_OK);
} catch {
  throw new Error('zstd is not executable');
}

async function CreateCompressStream(compLevel: number, opts: ZSTDOpts): Promise<Duplex> {
  let lvl = compLevel;
  let zo = opts.zstdOptions || [];
  let path: string | null = null;
  let cleanup: () => void = () => null;

  if (!lvl) lvl = 3;
  if (lvl < 1 || lvl > 22) lvl = 3;

  // Dictionary
  if (opts.dictionary && 'path' in opts.dictionary) {
    zo = [...zo, '-D', `${opts.dictionary.path}`];
  } else if (Buffer.isBuffer(opts.dictionary)) {
    // Use cached dictionary to avoid recreating temp files
    ({ path, cleanup } = await getCachedDictionaryPath(opts.dictionary));
    zo = [...zo, '-D', `${path}`];
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
      setImmediate(() => {
        c.destroy(new Error(`zstd exited non zero. code: ${code} signal: ${signal}`));
      });
    }
    cleanup();
  });

  return c;
}

function CompressBuffer(buffer: Buffer, c: Duplex): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const w = new BufferWritable({});

    c.once('close', () => {
      setImmediate(() => {
        const result = w.getBuffer();
        if (result) {
          resolve(result);
        } else {
          reject(new Error('Compression failed'));
        }
      });
    });

    pipeline(Readable.from(buffer), c, w)
      .then(() => {
        c.destroy();
      })
      .catch((err: Error) => {
        reject(err);
        c.destroy();
      });
  });
}

async function CreateDecompressStream(opts: ZSTDOpts): Promise<Duplex> {
  // Dictionary
  let zo = opts.zstdOptions || [];
  let path: string | null = null;
  let cleanup: () => void = () => null;

  let terminate = false;

  if (opts.dictionary && 'path' in opts.dictionary) {
    zo = [...zo, '-D', `${opts.dictionary.path}`];
  } else if (Buffer.isBuffer(opts.dictionary)) {
    // Use cached dictionary to avoid recreating temp files
    ({ path, cleanup } = await getCachedDictionaryPath(opts.dictionary));
    zo = [...zo, '-D', `${path}`];
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
      setImmediate(() => {
        d.destroy(new Error(`zstd exited non zero. code: ${code} signal: ${signal}`));
      });
    }
    cleanup();
  });

  const wrapper = new PeekPassThrough({ maxBuffer: 10 }, (data: Buffer, swap) => {
    if (isZst(data)) {
      swap(null, d);
    } else {
      debug('not zstd');
      terminate = true;
      d.end();
      swap(null, new PassThrough());
    }
  });

  // CRITICAL: Wrap _destroy to ensure ProcessDuplex is always destroyed
  const originalDestroy = wrapper._destroy.bind(wrapper);
  wrapper._destroy = function (error: Error | null, callback: (error: Error | null) => void) {
    if (!d.destroyed) {
      d.destroy();
    }
    originalDestroy(error, callback);
  };

  return wrapper;
}

function DecompressBuffer(buffer: Buffer, d: Duplex): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const w = new BufferWritable({});

    d.once('close', () => {
      setImmediate(() => {
        resolve(w.getBuffer() || Buffer.alloc(0));
      });
    });

    pipeline(Readable.from(buffer), d, w)
      .then(() => {
        d.destroy();
      })
      .catch((err: Error) => {
        reject(err);
        d.destroy();
      });
  });
}

// Standalone Functions

export function compress(compLevel: number, opts: ZSTDOpts = {}): Promise<Duplex> {
  return CreateCompressStream(compLevel, opts);
}

export async function compressBuffer(
  buffer: Buffer,
  compLevel: number,
  opts: ZSTDOpts = {}
): Promise<Buffer> {
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
  #compressDictCleanup: () => void = () => null;
  #decompressDictCleanup: () => void = () => null;
  #ready;
  #poolOptions?: PoolOpts;

  private constructor(poolOptions?: PoolOpts) {
    debug('constructor', poolOptions);
    this.#poolOptions = poolOptions;
    this.#compressDictCleanup = () => null;
    this.#decompressDictCleanup = () => null;

    this.#ready = new Promise((resolve, reject) => {
      (async () => {
        try {
          // Handle compress queue dictionary
          let compressDictPath: string | undefined = undefined;
          const compressDict = poolOptions?.compressQueue?.dictionary;
          if (compressDict && 'path' in compressDict) {
            compressDictPath = compressDict.path;
          } else if (compressDict && Buffer.isBuffer(compressDict)) {
            const { path, cleanup } = await file({ prefix: 'zstd-dict-' });
            this.#compressDictCleanup = cleanup;
            await writeFile(path, compressDict);
            compressDictPath = path;
          }

          // Handle decompress queue dictionary
          let decompressDictPath: string | undefined = undefined;
          const decompressDict = poolOptions?.decompressQueue?.dictionary;
          if (decompressDict && 'path' in decompressDict) {
            decompressDictPath = decompressDict.path;
          } else if (decompressDict && Buffer.isBuffer(decompressDict)) {
            const { path, cleanup } = await file({ prefix: 'zstd-dict-' });
            this.#decompressDictCleanup = cleanup;
            await writeFile(path, decompressDict);
            decompressDictPath = path;
          }

          this.#compressQueue = new ProcessQueue(
            poolOptions?.compressQueueSize || 0,
            () => {
              debug('compress factory');
              return CreateCompressStream(poolOptions?.compressQueue?.compLevel || 3, {
                ...poolOptions?.compressQueue,
                dictionary: compressDictPath ? { path: compressDictPath } : undefined,
              });
            },
            async (p: Promise<Duplex>) => {
              debug('compress cleanup');
              const stream = await p;
              await new Promise<void>((resolve) => {
                if (stream.destroyed) {
                  resolve();
                } else {
                  stream.once('close', () => resolve());
                  stream.destroy();
                }
              });
            }
          );

          this.#decompressQueue = new ProcessQueue(
            poolOptions?.decompressQueueSize || 0,
            () => {
              debug('decompress factory');
              return CreateDecompressStream({
                ...poolOptions?.decompressQueue,
                dictionary: decompressDictPath ? { path: decompressDictPath } : undefined,
              });
            },
            async (p: Promise<Duplex>) => {
              debug('decompress cleanup');
              const stream = await p;
              await new Promise<void>((resolve) => {
                if (stream.destroyed) {
                  resolve();
                } else {
                  stream.once('close', () => resolve());
                  stream.destroy();
                }
              });
            }
          );

          debug('READY');
          resolve(null);
        } catch (err) {
          reject(err);
        }
      })();
    }).catch((err) => {
      debug('ready error', err);
      this.#compressDictCleanup();
      this.#decompressDictCleanup();
      this.#compressDictCleanup = () => null;
      this.#decompressDictCleanup = () => null;
    });
  }

  /**
   * Create a new SimpleZSTD instance with process pooling
   * @param poolOptions - Configuration for compression and decompression process pools
   * @returns Promise resolving to initialized SimpleZSTD instance
   */
  static async create(poolOptions?: PoolOpts): Promise<SimpleZSTD> {
    const instance = new SimpleZSTD(poolOptions);
    await instance.#ready;
    return instance;
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

  async destroy() {
    await Promise.all([this.#compressQueue.destroy(), this.#decompressQueue.destroy()]);
    this.#compressDictCleanup();
    this.#decompressDictCleanup();
    this.#compressDictCleanup = () => null;
    this.#decompressDictCleanup = () => null;
  }

  /**
   * Get a compression stream from the pool, or create a one-off stream with custom compression level
   * @param compLevel - Optional compression level (1-22). If provided, creates a new stream instead of using the pool
   * @returns Promise resolving to a Duplex compression stream
   */
  async compress(compLevel?: number): Promise<Duplex> {
    await this.#ready;

    // If custom compression level is provided, create a one-off stream
    if (compLevel !== undefined) {
      return CreateCompressStream(compLevel, {
        ...this.#poolOptions?.compressQueue,
      });
    }

    // Otherwise, acquire from pool
    return this.#compressQueue.acquire();
  }

  /**
   * Compress a buffer using the pool, or with a custom compression level
   * @param buffer - Buffer to compress
   * @param compLevel - Optional compression level (1-22). If provided, uses this level instead of pool default
   * @returns Promise resolving to compressed buffer
   */
  async compressBuffer(buffer: Buffer, compLevel?: number): Promise<Buffer> {
    await this.#ready;
    const c = await this.compress(compLevel);
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
