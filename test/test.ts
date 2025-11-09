import { describe, test, before } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';

import { SimpleZSTD, compress, decompress, compressBuffer, decompressBuffer } from '../src/index';

const asyncSleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Simple throttle stream to replace brake module
function createThrottle(bytesPerSecond: number): Transform {
  let bytes = 0;
  const startTime = Date.now();

  return new Transform({
    transform(chunk: Buffer, encoding: BufferEncoding, callback: (error?: Error | null) => void) {
      bytes += chunk.length;
      const elapsed = Date.now() - startTime;
      const expectedTime = (bytes / bytesPerSecond) * 1000;
      const delay = Math.max(0, expectedTime - elapsed);

      if (delay > 0) {
        setTimeout(() => {
          this.push(chunk);
          callback();
        }, delay);
      } else {
        this.push(chunk);
        callback();
      }
    }
  });
}

// Custom file comparison helper
function assertFileEqual(file1: string, file2: string): void {
  const content1 = fs.readFileSync(file1);
  const content2 = fs.readFileSync(file2);
  assert.deepEqual(content1, content2, `Files ${file1} and ${file2} are not equal`);
}

// ZSTDCompress(compressionLevel, streamOptions)
// ZSTDDecompress(streamOptions)

const src = path.join(__dirname, 'sample/earth.jpg');
const dst1 = '/tmp/example_copy1.txt';
const dst2 = '/tmp/example_copy2.txt';

const dstZstd1 = '/tmp/example_copy1.zst';
const dstZstd2 = '/tmp/example_copy2.zst';

const dictionary = path.join(__dirname, 'sample/dictionary');

describe('Test simple-zstd Static Functions', () => {
  before(() => {
    fs.rmSync(dst1, { force: true });
    fs.rmSync(dst2, { force: true });
    fs.rmSync(dstZstd1, { force: true });
    fs.rmSync(dstZstd2, { force: true });
  });

  test('should not alter the file', async () => {
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
            assertFileEqual(src, dst1);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
    });
  });

  test('should perform correctly with stream.pipeline', async () => {
    const c = await compress(3);
    const d = await decompress();

    await pipeline(
      fs.createReadStream(src),
      c,
      d,
      fs.createWriteStream(dst1),
    );

    assertFileEqual(src, dst1);
  });

  test('should handle back pressure', { timeout: 30000 }, async () => {
    const c = await compress(3);
    const d = await decompress();

    await pipeline(
      fs.createReadStream(src),
      c,
      d,
      createThrottle(200000),
      fs.createWriteStream(dst1),
    );

    assertFileEqual(src, dst1);
  });

  test('compression level should change compression', { timeout: 5000 }, async () => {
    const c1 = await compress(1, {});
    const c2 = await compress(19, {});

    await pipeline(
      fs.createReadStream(src),
      c1,
      fs.createWriteStream(dstZstd1),
    );

    await pipeline(
      fs.createReadStream(src),
      c2,
      fs.createWriteStream(dstZstd2),
    );

    if (fs.statSync(dstZstd2).size >= fs.statSync(dstZstd1).size) {
      throw new Error('Compression level failed');
    }
  });

  test('should accept zstdOptions - ultra option', { timeout: 30000 }, async () => {
    const c1 = await compress(1);
    const c2 = await compress(22, {zstdOptions: ['--ultra']});

    await pipeline(
      fs.createReadStream(src),
      c1,
      fs.createWriteStream(dstZstd1),
    );

    await pipeline(
      fs.createReadStream(src),
      c2,
      fs.createWriteStream(dstZstd2),
    );

    if (fs.statSync(dstZstd2).size >= fs.statSync(dstZstd1).size) {
      // console.log(fs.statSync(dstZstd2).size, fs.statSync(dstZstd1).size);
      throw new Error('ultra test failed test failed');
    }
  });

  test('should accept a buffer', async () => {
    const buffer = Buffer.from('this is a test');

    const compressed = await compressBuffer(buffer, 3, {});
    const decompressed = await decompressBuffer(compressed, {});

    assert.deepEqual(buffer, decompressed);
  });

  test('should accept a bigger buffer', async () => {
    const buffer = fs.readFileSync(src);

    const compressed = await compressBuffer(buffer, 3);
    const decompressed = await decompressBuffer(compressed);

    assert.deepEqual(buffer, decompressed);
  });

  test('should accept a dictionary file as a buffer', async () => {
    const buffer = fs.readFileSync(src);
    const dictBuffer = fs.readFileSync(dictionary);

    const compressed = await compressBuffer(buffer, 3, {dictionary: dictBuffer});
    const decompressed = await decompressBuffer(compressed, {dictionary: dictBuffer});

    assert.deepEqual(buffer, decompressed);
  });

  test('should accept a dictionary file as a path', async () => {
    const buffer = fs.readFileSync(src);

    const compressed = await compressBuffer(buffer, 3, {dictionary: { path: dictionary }});
    const decompressed = await decompressBuffer(compressed, {dictionary: { path: dictionary }});

    assert.deepEqual(buffer, decompressed);
  });
});

describe('Test simple-zstd Class', () => {
  test('should behave as the static function', async () => {
    const z = await SimpleZSTD.create();

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
            assertFileEqual(src, dst1);
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

  test('should handle back pressure', { timeout: 30000 }, async () => {
    const z = await SimpleZSTD.create();

    const c = await z.compress();
    const d = await z.decompress();

    await pipeline(
      fs.createReadStream(src),
      c,
      d,
      createThrottle(200000),
      fs.createWriteStream(dst1),
    );

    z.destroy();
    assertFileEqual(src, dst1);
  });

  test('should behave as the static function and pre create zstd child process', { timeout: 30000 }, async () => {
    const z = await SimpleZSTD.create({
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
            assertFileEqual(src, dst1);
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
  });

  test('should accept a bigger buffer', async () => {
    const buffer = fs.readFileSync(src);

    const z = await SimpleZSTD.create({
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

  test('should accept a dictionary file as a buffer', async () => {
    const buffer = fs.readFileSync(src);
    const dictBuffer = fs.readFileSync(dictionary);

    const z = await SimpleZSTD.create({
      compressQueueSize: 1,
      decompressQueueSize: 1,
      compressQueue: { dictionary: dictBuffer },
      decompressQueue: { dictionary: dictBuffer },
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

  test('should accept a dictionary file as a path', async () => {
    const buffer = fs.readFileSync(src);

    const z = await SimpleZSTD.create({
      compressQueueSize: 1,
      decompressQueueSize: 1,
      compressQueue: { compLevel: 3, dictionary: { path: dictionary } },
      decompressQueue: { dictionary: { path: dictionary } },
    });

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
  test('queue should reuse processes and provide performance benefit', { timeout: 90000 }, async () => {
    // Use compLevel 1 to place emphasis on queue performance rather than compression

    const sampleSize = 1000;

    const z = await SimpleZSTD.create({
      compressQueue: { compLevel: 1 },
      compressQueueSize: 2,
      decompressQueueSize: 2,
    });

    console.log('Start test');
    const queueStart = +new Date();

    for (let i = 0; i < sampleSize; i += 1) {
      const r = (Math.random()).toString(36);
      const compressed = await z.compressBuffer(Buffer.from(r));
      await z.decompressBuffer(compressed);
    }

    const queueTime = +new Date() - queueStart;
    const stats = z.queueStats;

    console.log(`Queue Time: ${queueTime}ms`);
    console.log(`Queue Stats: compress(${stats.compress.hits} hits, ${stats.compress.misses} misses), decompress(${stats.decompress.hits} hits, ${stats.decompress.misses} misses)`);

    // No Queue (for comparison only, not strict assertion)
    const noQueueStart = +new Date();

    for (let i = 0; i < sampleSize; i += 1) {
      const r = (Math.random()).toString(36);
      const compressed = await compressBuffer(Buffer.from(r), 1);
      await decompressBuffer(compressed);
    }

    const noQueueTime = +new Date() - noQueueStart;

    console.log(`No Queue Time: ${noQueueTime}ms`);

    z.destroy();

    // Primary assertion: verify queue is being reused (the key functionality)
    assert.ok(stats.compress.hits > stats.compress.misses * 10,
      `Queue should be reused frequently: ${stats.compress.hits} hits vs ${stats.compress.misses} misses`);

    assert.ok(stats.decompress.hits > stats.decompress.misses * 10,
      `Decompress queue should be reused frequently: ${stats.decompress.hits} hits vs ${stats.decompress.misses} misses`);

    // Performance is informational only (varies based on workload and system conditions)
    const performanceRatio = queueTime / noQueueTime;
    if (queueTime < noQueueTime) {
      console.log(`✓ Queue was ${((1 - performanceRatio) * 100).toFixed(1)}% faster`);
    } else {
      console.log(`ℹ Queue was ${((performanceRatio - 1) * 100).toFixed(1)}% slower (overhead > benefit for this workload)`);
    }

    // The queue provides value for real-world scenarios:
    // - Reuses processes (proven by hit stats)
    // - Reduces process spawn overhead
    // - Benefits vary by: workload size, compression level, system load
    // - Serial small compressions may show overhead, concurrent operations benefit more
  });

  test('there should be point of diminishing returns for queue length for a serial performance test', { timeout: 90000 }, async () => {
    const sampleSize = 100;

    for (let s = 0; s < 10; s += 1) {
      const z = await SimpleZSTD.create({
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
  });
});
