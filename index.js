const ProcessStream = require('process-streams');
const { execSync } = require('child_process');
const fs = require('fs');
const isZst = require('is-zst');
const peek = require('peek-stream');
const through = require('through2');

const find = (process.platform === 'win32') ? 'where zstd.exe' : 'which zstd';

let bin;

try {
  bin = execSync(find, { env: process.env }).toString().replace(/\n$/, '');
} catch (err) {
  throw new Error('Can not access zstd! Is it installed?');
}

try {
  fs.accessSync(bin, fs.constants.X_OK);
} catch (err) {
  throw new Error('zstd is not executable');
}

exports.ZSTDCompress = function compress(compLevel, spawnOptions, streamOptions) {
  const ps = new ProcessStream();
  let lvl = compLevel;
  if (!lvl) lvl = 3;
  if (lvl < 1 || lvl > 22) lvl = 3;

  return ps.spawn(bin, [`-${lvl}`], spawnOptions, streamOptions);
};

exports.ZSTDDecompress = function decompress(spawnOptions, streamOptions) {
  const ps = new ProcessStream();
  return ps.spawn(bin, ['-d'], spawnOptions, streamOptions);
};

exports.ZSTDDecompressMaybe = function decompressMaybe(spawnOptions, streamOptions) {
  return peek({ newline: false, maxBuffer: 10 }, (data, swap) => {
    if (isZst(data)) return swap(null, exports.ZSTDDecompress(spawnOptions, streamOptions));
    return swap(null, through());
  });
};
