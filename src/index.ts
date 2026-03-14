import fs from 'node:fs';
import path from 'node:path';
import { writeFile, readFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Readable, Duplex, PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execSync, execFile } from 'node:child_process';

import isZst from 'is-zst';
import { dir } from 'tmp-promise';
import Debug from 'debug';

const debug = Debug('SimpleZSTD');

import ProcessQueue from './process-queue';
import BufferWritable from './buffer-writable';
import ProcessDuplex from './process-duplex';
import PeekPassThrough from './peek-transform';
import { ZSTDOpts, PoolOpts, CreateDictionaryOpts } from './types';

// Export types for consumers
export type {
  ZSTDOpts,
  PoolOpts,
  CompressOpts,
  DecompressOpts,
  DictionaryObject,
  CreateDictionaryOpts,
} from './types';

// Dictionary cache to avoid recreating temp files for the same dictionary buffer
// Map: hash -> { path: string, cleanup: () => void, refCount: number }
const dictionaryCache = new Map<
  string,
  { path: string; cleanup: () => Promise<void>; refCount: number }
>();

async function createTempDirectory(prefix: string): Promise<{
  directoryPath: string;
  cleanup: () => Promise<void>;
}> {
  const { path: tempDirectory, cleanup } = await dir({ prefix, unsafeCleanup: true });
  return {
    directoryPath: tempDirectory,
    cleanup: () => Promise.resolve(cleanup()),
  };
}

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
  const { directoryPath, cleanup: tmpCleanup } = await createTempDirectory('zstd-dict-cache-');
  const dictionaryPath = path.join(directoryPath, 'dictionary.zstd');
  await writeFile(dictionaryPath, dictionary);

  dictionaryCache.set(hash, {
    path: dictionaryPath,
    cleanup: tmpCleanup,
    refCount: 1,
  });

  return {
    path: dictionaryPath,
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
  let cleanup: () => void = () => null;

  if (!lvl) lvl = 3;
  if (lvl < 1 || lvl > 22) lvl = 3;

  // Dictionary
  if (opts.dictionary && 'path' in opts.dictionary) {
    zo = [...zo, '-D', `${opts.dictionary.path}`];
  } else if (Buffer.isBuffer(opts.dictionary)) {
    // Use cached dictionary to avoid recreating temp files
    const cached = await getCachedDictionaryPath(opts.dictionary);
    cleanup = cached.cleanup;
    zo = [...zo, '-D', cached.path];
  }

  let c: Duplex;

  try {
    debug(bin, ['-zc', `-${lvl}`, ...zo], opts.spawnOptions, opts.streamOptions);
    c = new ProcessDuplex({
      command: bin,
      args: ['-zc', `-${lvl}`, ...zo],
      spawnOptions: opts.spawnOptions,
      streamOptions: opts.streamOptions,
      nonZeroExitPolicy: true,
    });
  } catch (err) {
    // cleanup if error;
    cleanup();
    throw err;
  }

  c.on('exit', (code: number, signal) => {
    debug('c exit', code, signal);
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
  let cleanup: () => void = () => null;

  let terminate = false;

  if (opts.dictionary && 'path' in opts.dictionary) {
    zo = [...zo, '-D', `${opts.dictionary.path}`];
  } else if (Buffer.isBuffer(opts.dictionary)) {
    // Use cached dictionary to avoid recreating temp files
    const cached = await getCachedDictionaryPath(opts.dictionary);
    cleanup = cached.cleanup;
    zo = [...zo, '-D', cached.path];
  }

  let d: Duplex;

  try {
    debug(bin, ['-dc', ...zo], opts.spawnOptions, opts.streamOptions);
    d = new ProcessDuplex({
      command: bin,
      args: ['-dc', ...zo],
      spawnOptions: opts.spawnOptions,
      streamOptions: opts.streamOptions,
      nonZeroExitPolicy: () => !terminate,
    });
  } catch (err) {
    // cleanup if error
    cleanup();
    throw err;
  }

  d.on('exit', (code: number, signal) => {
    debug('d exit', code, signal);
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
  // Preserve "smart decompression" behavior for non-zstd payloads.
  if (!isZst(buffer)) {
    return buffer;
  }

  let zo = opts.zstdOptions || [];
  let cleanup: () => void = () => null;

  if (opts.dictionary && 'path' in opts.dictionary) {
    zo = [...zo, '-D', `${opts.dictionary.path}`];
  } else if (Buffer.isBuffer(opts.dictionary)) {
    const cachedDictionary = await getCachedDictionaryPath(opts.dictionary);
    zo = [...zo, '-D', `${cachedDictionary.path}`];
    cleanup = cachedDictionary.cleanup;
  }

  const args = ['-dc', ...zo];

  return new Promise((resolve, reject) => {
    debug(bin, args, opts.spawnOptions);
    const child = execFile(
      bin,
      args,
      {
        ...(opts.spawnOptions ?? {}),
        encoding: 'buffer',
        maxBuffer: 512 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        cleanup();

        if (!error) {
          resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout));
          return;
        }

        const code = typeof error.code === 'number' ? error.code : null;
        const signal = error.signal ?? null;
        const stdErrMessage = stderr?.toString().trim();
        const errorMessage = stdErrMessage
          ? `zstd decompression failed (code: ${code}, signal: ${signal}): ${stdErrMessage}`
          : `zstd decompression failed (code: ${code}, signal: ${signal})`;

        reject(new Error(errorMessage));
      }
    );

    child.stdin?.end(buffer);
  });
}

export async function createDictionary(opts: CreateDictionaryOpts): Promise<Buffer> {
  if (!Array.isArray(opts.trainingFiles) || opts.trainingFiles.length === 0) {
    throw new Error('createDictionary requires at least one training file or buffer');
  }

  const { path: tempRunDirectory, cleanup } = await dir({
    prefix: 'zstd-dict-create-run-',
    unsafeCleanup: true,
  });

  try {
    const trainingPaths: string[] = [];
    const outputPath = path.join(tempRunDirectory, 'dictionary.zstd');

    for (const [index, trainingInput] of opts.trainingFiles.entries()) {
      const stagedTrainingPath = path.join(tempRunDirectory, `training-${index}.bin`);

      if (typeof trainingInput === 'string') {
        await copyFile(trainingInput, stagedTrainingPath);
        trainingPaths.push(stagedTrainingPath);
        continue;
      }

      if (Buffer.isBuffer(trainingInput)) {
        await writeFile(stagedTrainingPath, trainingInput);
        trainingPaths.push(stagedTrainingPath);
        continue;
      }

      throw new Error('createDictionary trainingFiles entries must be file paths or Buffers');
    }

    const args = ['--train', ...trainingPaths, '-o', outputPath];

    if (opts.maxDictSize && opts.maxDictSize > 0) {
      args.push(`--maxdict=${opts.maxDictSize}`);
    }

    if (opts.zstdOptions?.length) {
      args.push(...opts.zstdOptions);
    }

    await new Promise<void>((resolve, reject) => {
      debug(bin, args, opts.spawnOptions);
      execFile(bin, args, opts.spawnOptions ?? {}, (error, _stdout, stderr) => {
        if (!error) {
          resolve();
          return;
        }

        const code = typeof error.code === 'number' ? error.code : null;
        const signal = error.signal ?? null;
        const stdErrMessage = stderr?.toString().trim();
        const errorMessage = stdErrMessage
          ? `zstd dictionary training failed (code: ${code}, signal: ${signal}): ${stdErrMessage}`
          : `zstd dictionary training failed (code: ${code}, signal: ${signal})`;

        reject(new Error(errorMessage));
      });
    });

    return readFile(outputPath);
  } finally {
    await cleanup();
  }
}

// SimpleZSTD Class
export class SimpleZSTD {
  #compressQueue!: ProcessQueue<Duplex>;
  #decompressQueue!: ProcessQueue<Duplex>;
  #compressDictCleanup: () => Promise<void> = async () => undefined;
  #decompressDictCleanup: () => Promise<void> = async () => undefined;
  #ready;
  #poolOptions?: PoolOpts;

  private constructor(poolOptions?: PoolOpts) {
    debug('constructor', poolOptions);
    this.#poolOptions = poolOptions;
    this.#compressDictCleanup = async () => undefined;
    this.#decompressDictCleanup = async () => undefined;

    this.#ready = new Promise((resolve, reject) => {
      (async () => {
        try {
          // Handle compress queue dictionary
          let compressDictPath: string | undefined = undefined;
          const compressDict = poolOptions?.compressQueue?.dictionary;
          if (compressDict && 'path' in compressDict) {
            compressDictPath = compressDict.path;
          } else if (compressDict && Buffer.isBuffer(compressDict)) {
            const { directoryPath, cleanup } = await createTempDirectory(
              'zstd-dict-pool-compress-'
            );
            const dictionaryPath = path.join(directoryPath, 'dictionary.zstd');
            this.#compressDictCleanup = cleanup;
            await writeFile(dictionaryPath, compressDict);
            compressDictPath = dictionaryPath;
          }

          // Handle decompress queue dictionary
          let decompressDictPath: string | undefined = undefined;
          const decompressDict = poolOptions?.decompressQueue?.dictionary;
          if (decompressDict && 'path' in decompressDict) {
            decompressDictPath = decompressDict.path;
          } else if (decompressDict && Buffer.isBuffer(decompressDict)) {
            const { directoryPath, cleanup } = await createTempDirectory(
              'zstd-dict-pool-decompress-'
            );
            const dictionaryPath = path.join(directoryPath, 'dictionary.zstd');
            this.#decompressDictCleanup = cleanup;
            await writeFile(dictionaryPath, decompressDict);
            decompressDictPath = dictionaryPath;
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
      void this.#compressDictCleanup();
      void this.#decompressDictCleanup();
      this.#compressDictCleanup = async () => undefined;
      this.#decompressDictCleanup = async () => undefined;
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
    await this.#compressDictCleanup();
    await this.#decompressDictCleanup();
    this.#compressDictCleanup = async () => undefined;
    this.#decompressDictCleanup = async () => undefined;
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
