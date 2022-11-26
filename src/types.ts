export interface CompressOpts {
  compLevel?: Number,
  dictionary?: Buffer | { path: string },
  zstdOptions?: Array<string>,
  spawnOptions?: Object,
  streamOptions?: Object,
}

export interface DecompressOpts {
  dictionary?: Buffer | { path: string },
  zstdOptions?: Array<string>,
  spawnOptions?: Object,
  streamOptions?: Object,
}

export interface PoolOpts {
  compressQueueSize?: Number,
  decompressQueueSize?: Number,
  compressQueue?: CompressOpts,
  decompressQueue?: DecompressOpts,
}

export interface DictionaryObject {
  path: string;
}

export interface ZSTDOpts {
  spawnOptions?: object;
  streamOptions?: object;
  zstdOptions?: string[];
  dictionary?: DictionaryObject | Buffer;
}