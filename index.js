
const { spawn } = require('duplex-child-process');
const { execSync } = require('child_process');
const fs = require('fs');

const find = (process.platform === 'win32') ? 'where zstd.exe' : 'which zstd';

let bin;

try {
  bin = execSync(find, { env: process.env }).toString().replace(/\n$/, '');
} catch (err) {
  throw new Error('Can not access zstd! Is it installed?');
}

if (!fs.accessSync(bin, fs.constants.X_OK)) {
  throw new Error('zstd is not executable');
}

exports.ZSTDCompress = function compress(compLevel) {
  let lvl = compLevel;
  if (!lvl) lvl = 3;
  if (lvl < 1 || lvl > 22) lvl = 3;
  return spawn(bin, [`-${lvl}`], {});
};

exports.ZSTDDecompress = function decompress() {
  return spawn(bin, ['-d'], {});
};
