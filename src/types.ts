import {SpawnOptions} from 'child_process';
import {TransformOptions} from 'stream';

export interface CompressOpts {
  compLevel?: number,
  dictionary?: Buffer | { path: string },
  zstdOptions?: Array<string>,
  spawnOptions?: SpawnOptions,
  streamOptions?: TransformOptions,
}

export interface DecompressOpts {
  dictionary?: Buffer | { path: string },
  zstdOptions?: Array<string>,
  spawnOptions?: SpawnOptions,
  streamOptions?: TransformOptions,
}

export interface PoolOpts {
  compressQueueSize?: number,
  decompressQueueSize?: number,
  compressQueue?: CompressOpts,
  decompressQueue?: DecompressOpts,
}

export interface DictionaryObject {
  path: string;
}

export interface ZSTDOpts {
  spawnOptions?: object;
  streamOptions?: TransformOptions;
  zstdOptions?: string[];
  dictionary?: DictionaryObject | Buffer;
}