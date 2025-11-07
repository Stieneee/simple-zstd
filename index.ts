import ProcessStream from 'process-streams';
import { execSync, SpawnOptions } from 'child_process';
import * as fs from 'fs';
import isZst from 'is-zst';
import peek from 'peek-stream';
import through from 'through2';
import { Duplex, DuplexOptions } from 'stream';

const find = (process.platform === 'win32') ? 'where zstd.exe' : 'which zstd';

let bin: string;

try {
  bin = execSync(find, { env: process.env }).toString().replace(/\n$/, '').replace(/\r$/, '');
} catch (err) {
  throw new Error('Can not access zstd! Is it installed?');
}

try {
  fs.accessSync(bin, fs.constants.X_OK);
} catch (err) {
  throw new Error('zstd is not executable');
}

export function ZSTDCompress(
  compLevel?: number,
  spawnOptions?: SpawnOptions,
  streamOptions?: DuplexOptions,
  zstdOptions: string[] = []
): Duplex {
  const ps = new ProcessStream();

  let lvl = compLevel;
  if (!lvl || typeof lvl !== 'number') lvl = 3;
  lvl = parseInt(lvl.toString(), 10); // Ensure that lvl is an integer
  if (Number.isNaN(lvl) || lvl < 1 || lvl > 22) lvl = 3;

  const c = ps.spawn(bin, [`-${lvl}`, ...zstdOptions], spawnOptions, streamOptions)
    .on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      if (code !== 0) {
        setTimeout(() => {
          c.destroy(new Error(`zstd exited non zero. code: ${code} signal: ${signal}`));
        }, 1);
      }
    });

  return c;
}

export function ZSTDDecompress(
  spawnOptions?: SpawnOptions,
  streamOptions?: DuplexOptions,
  zstdOptions: string[] = []
): Duplex {
  const ps = new ProcessStream();
  return ps.spawn(bin, ['-d', ...zstdOptions], spawnOptions, streamOptions);
}

export function ZSTDDecompressMaybe(
  spawnOptions?: SpawnOptions,
  streamOptions?: DuplexOptions,
  zstdOptions: string[] = []
): Duplex {
  return peek({ newline: false, maxBuffer: 10 }, (data: Buffer, swap: (err: Error | null, stream: Duplex) => void) => {
    if (isZst(data)) return swap(null, ZSTDDecompress(spawnOptions, streamOptions, zstdOptions));
    return swap(null, through());
  });
}
