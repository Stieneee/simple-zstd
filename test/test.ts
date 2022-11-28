/* eslint-env node, mocha */

import fs from 'node:fs';
import path from 'node:path';
import stream from 'node:stream';

import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import chaiFs from 'chai-fs';

import brake from 'brake';
import { promisify } from 'util';
const pipelineAsync = promisify(stream.pipeline);

import { SimpleZSTD, compress, decompress, compressBuffer, decompressBuffer } from '../src/index';

chai.use(chaiFs);
chai.use(chaiAsPromised); // use last

const { assert } = chai;

const asyncSleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ZSTDCompress(compressionLevel, streamOptions)
// ZSTDDecompress(streamOptions)

const src = path.join(__dirname, 'sample/earth.jpg');
const dst1 = '/tmp/example_copy1.txt';
const dst2 = '/tmp/example_copy2.txt';

const dstZstd1 = '/tmp/example_copy1.zst';
const dstZstd2 = '/tmp/example_copy2.zst';

const dictionary = path.join(__dirname, 'sample/dictionary');

describe('Test simple-zstd Static Functions', () => {
  beforeEach(() => {
    fs.rmSync(dst1, { force: true });
    fs.rmSync(dst2, { force: true });
    fs.rmSync(dstZstd1, { force: true });
    fs.rmSync(dstZstd2, { force: true });
  });

  it('should not alter the file', async () => {
    const c = await compress(3);
    const d = await decompress();

    return new Promise((resolve, reject) => {
      fs.createReadStream(src)
        .pipe(c)
        .pipe(d)
        .pipe(fs.createWriteStream(dst1))
        .on('error', reject)
        .on('finish', () => {
          try {
            assert.fileEqual(src, dst1);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
    });
  });

  it('should perform correctly with stream.pipeline', async () => {
    const c = await compress(3);
    const d = await decompress();

    await pipelineAsync(
      fs.createReadStream(src),
      c,
      d,
      fs.createWriteStream(dst1),
    );

    assert.fileEqual(src, dst1);
  });

  it('should handle back pressure', async () => {
    const c = await compress(3);
    const d = await decompress();

    await pipelineAsync(
      fs.createReadStream(src),
      c,
      d,
      brake(200000),
      fs.createWriteStream(dst1),
    );

    assert.fileEqual(src, dst1);
  }).timeout(30000);

  it('compression level should change compression', async () => {
    const c1 = await compress(1, {});
    const c2 = await compress(19, {});

    await pipelineAsync(
      fs.createReadStream(src),
      c1,
      fs.createWriteStream(dstZstd1),
    );

    await pipelineAsync(
      fs.createReadStream(src),
      c2,
      fs.createWriteStream(dstZstd2),
    );

    if (fs.statSync(dstZstd2).size >= fs.statSync(dstZstd1).size) {
      throw new Error('Compression level failed');
    }
  }).timeout(5000);

  it('should accept zstdOptions - ultra option', async () => {
    const c1 = await compress(1);
    const c2 = await compress(22, {zstdOptions: ['--ultra']});

    await pipelineAsync(
      fs.createReadStream(src),
      c1,
      fs.createWriteStream(dstZstd1),
    );

    await pipelineAsync(
      fs.createReadStream(src),
      c2,
      fs.createWriteStream(dstZstd2),
    );

    if (fs.statSync(dstZstd2).size >= fs.statSync(dstZstd1).size) {
      // console.log(fs.statSync(dstZstd2).size, fs.statSync(dstZstd1).size);
      throw new Error('ultra test failed test failed');
    }
  }).timeout(30000);

  it('should accept a buffer', async () => {
    const buffer = Buffer.from('this is a test');

    const compressed = await compressBuffer(buffer, 3, {});
    const decompressed = await decompressBuffer(compressed, {});

    assert.deepEqual(buffer, decompressed);
  });

  it('should accept a bigger buffer', async () => {
    const buffer = fs.readFileSync(src);

    const compressed = await compressBuffer(buffer, 3);
    const decompressed = await decompressBuffer(compressed);

    assert.deepEqual(buffer, decompressed);
  });

  it('should accept a dictionary file as a buffer', async () => {
    const buffer = fs.readFileSync(src);
    const dictBuffer = fs.readFileSync(dictionary);

    const compressed = await compressBuffer(buffer, 3, {dictionary: dictBuffer});
    const decompressed = await decompressBuffer(compressed, {dictionary: dictBuffer});

    assert.deepEqual(buffer, decompressed);
  });

  it('should accept a dictionary file as a path', async () => {
    const buffer = fs.readFileSync(src);

    const compressed = await compressBuffer(buffer, 3, {dictionary: { path: dictionary }});
    const decompressed = await decompressBuffer(compressed, {dictionary: { path: dictionary }});

    assert.deepEqual(buffer, decompressed);
  });
});

describe('Test simple-zstd Class', () => {
  it('should behave as the static function', async () => {
    const z = new SimpleZSTD();

    const c = await z.compress();
    const d = await z.decompress();

    return new Promise((resolve, reject) => {
      fs.createReadStream(src)
        .pipe(c)
        .pipe(d)
        .pipe(fs.createWriteStream(dst1))
        .on('error', reject)
        .on('finish', () => {
          try {
            assert.fileEqual(src, dst1);
            assert.equal(z.queueStats.compress.hits, 0);
            assert.equal(z.queueStats.compress.misses, 1);
            assert.equal(z.queueStats.decompress.hits, 0);
            assert.equal(z.queueStats.compress.misses, 1);
            z.destroy();
            resolve();
          } catch (err) {
            reject(err);
          }
        });
    });
  });

  it('should handle back pressure', async () => {
    const z = new SimpleZSTD();

    const c = await z.compress();
    const d = await z.decompress();

    await pipelineAsync(
      fs.createReadStream(src),
      c,
      d,
      brake(200000),
      fs.createWriteStream(dst1),
    );

    z.destroy();
    assert.fileEqual(src, dst1);
  }).timeout(30000);

  it('should behave as the static function and pre create zstd child process', async () => {
    const z = new SimpleZSTD({
      compressQueueSize: 1,
      decompressQueueSize: 1,
    });

    const c = await z.compress();
    const d = await z.decompress();

    return new Promise((resolve, reject) => {
      fs.createReadStream(src)
        .pipe(c)
        .pipe(d)
        .pipe(fs.createWriteStream(dst1))
        .on('error', reject)
        .on('finish', () => {
          try {
            assert.fileEqual(src, dst1);
            assert.equal(z.queueStats.compress.hits, 1);
            assert.equal(z.queueStats.compress.misses, 0);
            assert.equal(z.queueStats.decompress.hits, 1);
            assert.equal(z.queueStats.compress.misses, 0);

            z.destroy();
            resolve();
          } catch (err) {
            reject(err);
          }
        });
    });
  }).timeout(30000);

  it('should accept a bigger buffer', async () => {
    const buffer = fs.readFileSync(src);

    const z = new SimpleZSTD({
      compressQueueSize: 1,
      decompressQueueSize: 1,
    });

    const compressed = await z.compressBuffer(buffer);
    const decompressed = await z.decompressBuffer(compressed);

    z.destroy();
    assert.deepEqual(buffer, decompressed);
    assert.equal(z.queueStats.compress.hits, 1);
    assert.equal(z.queueStats.compress.misses, 0);
    assert.equal(z.queueStats.decompress.hits, 1);
    assert.equal(z.queueStats.compress.misses, 0);
  });

  it('should accept a dictionary file as a buffer', async () => {
    const buffer = fs.readFileSync(src);
    const dictBuffer = fs.readFileSync(dictionary);

    const z = new SimpleZSTD({
      compressQueueSize: 1,
      decompressQueueSize: 1,
    }, dictBuffer);

    const compressed = await z.compressBuffer(buffer);
    const decompressed = await z.decompressBuffer(compressed);

    z.destroy();
    assert.deepEqual(buffer, decompressed);
    assert.equal(z.queueStats.compress.hits, 1);
    assert.equal(z.queueStats.compress.misses, 0);
    assert.equal(z.queueStats.decompress.hits, 1);
    assert.equal(z.queueStats.compress.misses, 0);
  });

  it('should accept a dictionary file as a path', async () => {
    const buffer = fs.readFileSync(src);

    const z = new SimpleZSTD({
      compressQueueSize: 1,
      decompressQueueSize: 1,
      compressQueue: { compLevel: 3 },
      decompressQueue: {},
    }, { path: dictionary });

    const compressed = await z.compressBuffer(buffer);
    const decompressed = await z.decompressBuffer(compressed);

    assert.equal(z.queueStats.compress.hits, 1);
    assert.equal(z.queueStats.compress.misses, 0);
    assert.equal(z.queueStats.decompress.hits, 1);
    assert.equal(z.queueStats.compress.misses, 0);

    z.destroy();
    assert.deepEqual(buffer, decompressed);
  });
});

describe('Performance Tests', () => {
  it('should be faster with a queue for large number of requests', async () => {
    // Use compLevel 1 time to place emphasis on the queue performance

    const sampleSize = 1000;

    const z = new SimpleZSTD({
      compressQueue: { compLevel: 1 },
      decompressQueue: {},
    });

    // await asyncSleep(100);

    console.log('Start test');
    const queueStart = +new Date();

    for (let i = 0; i < sampleSize; i += 1) {
      const r = (Math.random()).toString(36);
      const compressed = await z.compressBuffer(Buffer.from(r));
      await z.decompressBuffer(compressed);
    }

    const queueTime = +new Date() - queueStart;

    console.log(`Queue Time: ${queueTime}ms`);

    // No Queue

    const noQueueStart = +new Date();

    for (let i = 0; i < sampleSize; i += 1) {
      const r = (Math.random()).toString(36);
      const compressed = await compressBuffer(Buffer.from(r), 1);
      await decompressBuffer(compressed);
    }

    const noQueueTime = +new Date() - noQueueStart;

    console.log(`No Queue Time: ${noQueueTime}ms`);

    z.destroy();

    assert.isBelow(queueTime, noQueueTime);
  }).timeout(30000);

  it('there should be point of diminishing returns for queue length for a serial performance test', async () => {
    const sampleSize = 100;

    for (let s = 0; s < 10; s += 1) {
      const z = new SimpleZSTD({
        compressQueueSize: s,
        decompressQueueSize: s,
        compressQueue: { compLevel: 1 },
        decompressQueue: {},
      });

      await asyncSleep(100);

      const queueStart = +new Date();

      for (let i = 0; i < sampleSize; i += 1) {
        const r = (Math.random()).toString(36);
        const compressed = await z.compressBuffer(Buffer.from(r));
        await z.decompressBuffer(compressed);
      }

      const queueTime = +new Date() - queueStart;

      console.log(`Queue ${s} Time: ${queueTime}ms`);
      z.destroy();
    }
  }).timeout(30000);
});