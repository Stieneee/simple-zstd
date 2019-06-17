const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ZSTDCompress, ZSTDDecompress } = require('../index');

// ZSTDCompress(compressionLevel, streamOptions)
// ZSTDDecompress(streamOptions)

const src = path.join(__dirname, 'sample/example.txt');
const dst = path.join(__dirname, 'sample/example_copy.txt');

fs.createReadStream(src)
  .pipe(ZSTDCompress(3))
  .pipe(ZSTDDecompress())
  .pipe(fs.createWriteStream(dst))
  .on('error', (err) => {
    console.error(err);
    process.exit(1);
  })
  .on('finish', () => {
    console.log('Copy Complete!');
    spawnSync(`/usr/bin/diff ${src} ${dst}`, { env: process.env });
  });
