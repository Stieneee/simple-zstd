/* eslint-env node, mocha */

import * as fs from 'fs';
import * as path from 'path';
import * as stream from 'stream';
import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import brake from 'brake';
import { promisify } from 'util';
import { ZSTDCompress, ZSTDDecompress, ZSTDDecompressMaybe } from '../index';

chai.use(require('chai-fs'));
chai.use(chaiAsPromised); // use last

const { assert } = chai;

const pipelineAsync = promisify(stream.pipeline);

const src = path.join(__dirname, 'sample/earth.jpg');
const dst1 = '/tmp/example_copy1.txt';
const dst2 = '/tmp/example_copy2.txt';

const dstZstd1 = '/tmp/example_copy1.zst';
const dstZstd2 = '/tmp/example_copy2.zst';

describe('Test simple-zstd', () => {
  beforeEach(() => {
    fs.rmSync(dst1, { force: true });
    fs.rmSync(dst2, { force: true });
    fs.rmSync(dstZstd1, { force: true });
    fs.rmSync(dstZstd2, { force: true });
  });

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

  it('decompress maybe should passthrough non zstd data', (done) => {
    fs.createReadStream(src)
      .pipe(ZSTDDecompressMaybe())
      .pipe(fs.createWriteStream(dst2))
      .on('error', done)
      .on('finish', () => {
        try {
          assert.fileEqual(src, dst2, done);
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
      fs.createWriteStream(dst2),
      done,
    );
  });

  it('should handle back pressure', (done) => {
    stream.pipeline(
      fs.createReadStream(src),
      ZSTDCompress(3),
      ZSTDDecompressMaybe(),
      brake(200000),
      fs.createWriteStream(dst2),
      done,
    );
  }).timeout(30000);

  it('compression level should change compression', async () => {
    await pipelineAsync(
      fs.createReadStream(src),
      ZSTDCompress(1, {}, {}, []),
      fs.createWriteStream(dstZstd1),
    );

    await pipelineAsync(
      fs.createReadStream(src),
      ZSTDCompress(19, {}, {}, []),
      fs.createWriteStream(dstZstd2),
    );

    if (fs.statSync(dstZstd2).size >= fs.statSync(dstZstd1).size) {
      throw new Error('Compression level failed');
    }
  });

  it('should accept zstdOptions - ultra option', async () => {
    await pipelineAsync(
      fs.createReadStream(src),
      ZSTDCompress(1),
      fs.createWriteStream(dstZstd1),
    );

    await pipelineAsync(
      fs.createReadStream(src),
      ZSTDCompress(22, {}, {}, ['--ultra']),
      fs.createWriteStream(dstZstd2),
    );

    if (fs.statSync(dstZstd2).size >= fs.statSync(dstZstd1).size) {
      console.log(fs.statSync(dstZstd2).size, fs.statSync(dstZstd1).size);
      throw new Error('ultra test failed test failed');
    }
  });

  it('should throw an error if zstd is called incorrectly', async () => {
    // missing --ultra flag
    const compress = ZSTDCompress(22, {}, {}, ['']);

    await chai.expect(pipelineAsync(
      fs.createReadStream(src),
      compress,
      fs.createWriteStream(dstZstd2),
    )).to.be.rejected;
  }).timeout(30000);
});
