const ProcessStream = require('process-streams');
const { execSync } = require('child_process');
const fs = require('fs');
const isZst = require('is-zst');
const peek = require('peek-stream');
const through = require('through2');

const find = (process.platform === 'win32') ? 'where zstd.exe' : 'which zstd';

let bin;

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

// const cX = 0;

exports.ZSTDCompress = function compress(compLevel, spawnOptions, streamOptions, zstdOptions = []) {
  // const x = cX;
  // cX += 1;
  const ps = new ProcessStream();

  let lvl = compLevel;
  if (!lvl || typeof lvl !== 'number') lvl = 3;
  lvl = parseInt(lvl, 10); // Ensure that lvl is an integer
  if (Number.isNaN(lvl) || lvl < 1 || lvl > 22) lvl = 3;

  const c = ps.spawn(bin, [`-${lvl}`, ...zstdOptions], spawnOptions, streamOptions)
    .on('exit', (code, signal) => {
      // console.log(x, 'exit', code, signal);
      if (code !== 0) {
        setTimeout(() => {
          c.destroy(new Error(`zstd exited non zero. code: ${code} signal: ${signal}`));
        }, 1);
      }
    });
    // .on('end', () => {
    //   console.log(x, 'end');
    // })
    // .on('close', () => {
    //   console.log(x, 'close');
    // })
    // .on('destroy', () => {
    //   console.log(x, 'destroy');
    // });

  return c;
};

exports.ZSTDDecompress = function decompress(spawnOptions, streamOptions, zstdOptions = []) {
  const ps = new ProcessStream();
  return ps.spawn(bin, ['-d', ...zstdOptions], spawnOptions, streamOptions);
};

exports.ZSTDDecompressMaybe = function decompressMaybe(spawnOptions, streamOptions, zstdOptions = []) {
  return peek({ newline: false, maxBuffer: 10 }, (data, swap) => {
    if (isZst(data)) return swap(null, exports.ZSTDDecompress(spawnOptions, streamOptions, zstdOptions));
    return swap(null, through());
  });
};
