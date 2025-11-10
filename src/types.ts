import { SpawnOptions } from 'child_process';
import { DuplexOptions } from 'stream';

export interface CompressOpts {
  compLevel?: number;
  dictionary?: Buffer | { path: string };
  zstdOptions?: Array<string>;
  spawnOptions?: SpawnOptions;
  streamOptions?: DuplexOptions;
}

export interface DecompressOpts {
  dictionary?: Buffer | { path: string };
  zstdOptions?: Array<string>;
  spawnOptions?: SpawnOptions;
  streamOptions?: DuplexOptions;
}

export interface PoolOpts {
  compressQueueSize?: number;
  decompressQueueSize?: number;
  compressQueue?: CompressOpts;
  decompressQueue?: DecompressOpts;
}

export interface DictionaryObject {
  path: string;
}

export interface ZSTDOpts {
  spawnOptions?: object;
  streamOptions?: DuplexOptions;
  zstdOptions?: string[];
  dictionary?: DictionaryObject | Buffer;
}
