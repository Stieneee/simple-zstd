/* eslint-env node, mocha */

const fs = require('fs');
const path = require('path');
const stream = require('stream');
const chai = require('chai');
const brake = require('brake');
const { ZSTDCompress, ZSTDDecompress, ZSTDDecompressMaybe } = require('../index');

chai.use(require('chai-fs'));

const { assert } = chai;

// ZSTDCompress(compressionLevel, streamOptions)
// ZSTDDecompress(streamOptions)

const src = path.join(__dirname, 'sample/earth.jpg');
const dst1 = '/tmp/example_copy1.txt';
const dst2 = '/tmp/example_copy2.txt';
const dst3 = '/tmp/example_copy3.txt';

describe('Test simple-zstd', () => {
  it('should not alter the file', (done) => {
    fs.createReadStream(src)
      .pipe(ZSTDCompress(3))
      .pipe(ZSTDDecompress())
      .pipe(fs.createWriteStream(dst1))
      .on('error', done)
      .on('finish', () => {
        try {
          assert.fileEqual(src, dst1, done);
          done();
        } catch (err) {
          done(err);
        }
      });
  });

  it('decompress maybe should produce the same result', (done) => {
    fs.createReadStream(src)
      .pipe(ZSTDCompress(3))
      .pipe(ZSTDDecompressMaybe())
      .pipe(fs.createWriteStream(dst2))
      .on('error', done)
      .on('finish', () => {
        try {
          assert.fileEqual(src, dst1, done);
          done();
        } catch (err) {
          done(err);
        }
      });
  });

  it('decompress maybe should passthrough non zstd data', (done) => {
    fs.createReadStream(src)
      .pipe(ZSTDDecompressMaybe())
      .pipe(fs.createWriteStream(dst3))
      .on('error', done)
      .on('finish', () => {
        try {
          assert.fileEqual(src, dst3, done);
          done();
        } catch (err) {
          done(err);
        }
      });
  });

  it('should perform correctly with stream.pipeline', (done) => {
    stream.pipeline(
      fs.createReadStream(src),
      ZSTDCompress(3),
      ZSTDDecompressMaybe(),
      fs.createWriteStream(dst3),
      done,
    );
  });

  it('should handle back pressure', (done) => {
    stream.pipeline(
      fs.createReadStream(src),
      ZSTDCompress(3),
      ZSTDDecompressMaybe(),
      brake(200000),
      fs.createWriteStream(dst3),
      done,
    );
  }).timeout(30000);
});
