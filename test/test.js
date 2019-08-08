const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ZSTDCompress, ZSTDDecompress, ZSTDDecompressMaybe } = require('../index');

// ZSTDCompress(compressionLevel, streamOptions)
// ZSTDDecompress(streamOptions)

const src = path.join(__dirname, 'sample/example.txt');
const dst1 = '/tmp/example_copy1.txt';
const dst2 = '/tmp/example_copy2.txt';
const dst3 = '/tmp/example_copy3.txt';


// Normal
fs.createReadStream(src)
  .pipe(ZSTDCompress(3))
  .pipe(ZSTDDecompress())
  .pipe(fs.createWriteStream(dst1))
  .on('error', (err) => {
    console.error(err);
    process.exit(1);
  })
  .on('finish', () => {
    console.log('Copy Complete!');
    spawnSync(`/usr/bin/diff ${src} ${dst1}`, { env: process.env });
  });

// Maybe
fs.createReadStream(src)
  .pipe(ZSTDCompress(3))
  .pipe(ZSTDDecompressMaybe())
  .pipe(fs.createWriteStream(dst2))
  .on('error', (err) => {
    console.error(err);
    process.exit(1);
  })
  .on('finish', () => {
    console.log('Copy Complete!');
    spawnSync(`/usr/bin/diff ${src} ${dst2}`, { env: process.env });
  });

// Maybe passthrough
fs.createReadStream(src)
  .pipe(ZSTDDecompressMaybe())
  .pipe(fs.createWriteStream(dst3))
  .on('error', (err) => {
    console.error(err);
    process.exit(1);
  })
  .on('finish', () => {
    console.log('Copy Complete!');
    spawnSync(`/usr/bin/diff ${src} ${dst3}`, { env: process.env });
  });
