import { describe, test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';

import { SimpleZSTD, compressBuffer, decompressBuffer } from '../src/index';
import {
  createThrottle,
  assertFileEqual,
  sourceFile,
  dictionaryFile,
  createTestOutputPaths,
} from './test-helpers';

const { dst1 } = createTestOutputPaths('class-and-performance');

describe('Test simple-zstd Class', () => {
  test('should behave as the static function', async () => {
    const z = await SimpleZSTD.create();

    const c = await z.compress();
    const d = await z.decompress();

    return new Promise((resolve, reject) => {
      fs.createReadStream(sourceFile)
        .pipe(c)
        .pipe(d)
        .pipe(fs.createWriteStream(dst1))
        .on('error', async (err) => {
          c.destroy();
          d.destroy();
          await z.destroy();
          reject(err);
        })
        .on('finish', async () => {
          try {
            assertFileEqual(sourceFile, dst1);
            assert.equal(z.queueStats.compress.hits, 0);
            assert.equal(z.queueStats.compress.misses, 1);
            assert.equal(z.queueStats.decompress.hits, 0);
            assert.equal(z.queueStats.compress.misses, 1);
            c.destroy();
            d.destroy();
            await z.destroy();
            resolve();
          } catch (err) {
            c.destroy();
            d.destroy();
            await z.destroy();
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
      fs.createReadStream(sourceFile),
      c,
      d,
      createThrottle(200000),
      fs.createWriteStream(dst1)
    );

    await z.destroy();
    assertFileEqual(sourceFile, dst1);
  });

  test(
    'should behave as the static function and pre create zstd child process',
    { timeout: 30000 },
    async () => {
      const z = await SimpleZSTD.create({
        compressQueueSize: 1,
        decompressQueueSize: 1,
      });

      const c = await z.compress();
      const d = await z.decompress();

      return new Promise((resolve, reject) => {
        fs.createReadStream(sourceFile)
          .pipe(c)
          .pipe(d)
          .pipe(fs.createWriteStream(dst1))
          .on('error', async (err) => {
            c.destroy();
            d.destroy();
            await z.destroy();
            reject(err);
          })
          .on('finish', async () => {
            try {
              assertFileEqual(sourceFile, dst1);
              assert.equal(z.queueStats.compress.hits, 1);
              assert.equal(z.queueStats.compress.misses, 0);
              assert.equal(z.queueStats.decompress.hits, 1);
              assert.equal(z.queueStats.compress.misses, 0);
              c.destroy();
              d.destroy();
              await z.destroy();
              resolve();
            } catch (err) {
              c.destroy();
              d.destroy();
              await z.destroy();
              reject(err);
            }
          });
      });
    }
  );

  test('should accept a bigger buffer', async () => {
    const buffer = fs.readFileSync(sourceFile);
    const z = await SimpleZSTD.create({
      compressQueueSize: 1,
      decompressQueueSize: 1,
    });

    const compressed = await z.compressBuffer(buffer);
    const decompressed = await z.decompressBuffer(compressed);

    await z.destroy();
    assert.deepEqual(buffer, decompressed);
    assert.equal(z.queueStats.compress.hits, 1);
    assert.equal(z.queueStats.compress.misses, 0);
    assert.equal(z.queueStats.decompress.hits, 1);
    assert.equal(z.queueStats.compress.misses, 0);
  });

  test('should accept a dictionary file as a buffer', async () => {
    const buffer = fs.readFileSync(sourceFile);
    const dictBuffer = fs.readFileSync(dictionaryFile);

    const z = await SimpleZSTD.create({
      compressQueueSize: 1,
      decompressQueueSize: 1,
      compressQueue: { dictionary: dictBuffer },
      decompressQueue: { dictionary: dictBuffer },
    });

    const compressed = await z.compressBuffer(buffer);
    const decompressed = await z.decompressBuffer(compressed);

    await z.destroy();
    assert.deepEqual(buffer, decompressed);
    assert.equal(z.queueStats.compress.hits, 1);
    assert.equal(z.queueStats.compress.misses, 0);
    assert.equal(z.queueStats.decompress.hits, 1);
    assert.equal(z.queueStats.compress.misses, 0);
  });

  test('should accept a dictionary file as a path', async () => {
    const buffer = fs.readFileSync(sourceFile);

    const z = await SimpleZSTD.create({
      compressQueueSize: 1,
      decompressQueueSize: 1,
      compressQueue: { compLevel: 3, dictionary: { path: dictionaryFile } },
      decompressQueue: { dictionary: { path: dictionaryFile } },
    });

    const compressed = await z.compressBuffer(buffer);
    const decompressed = await z.decompressBuffer(compressed);

    assert.equal(z.queueStats.compress.hits, 1);
    assert.equal(z.queueStats.compress.misses, 0);
    assert.equal(z.queueStats.decompress.hits, 1);
    assert.equal(z.queueStats.compress.misses, 0);

    await z.destroy();
    assert.deepEqual(buffer, decompressed);
  });
});

describe('Performance Tests', () => {
  test(
    'queue should reuse processes and provide performance benefit',
    { timeout: 60000 },
    async () => {
      const sampleSize = 500;

      const z = await SimpleZSTD.create({
        compressQueue: { compLevel: 1 },
        compressQueueSize: 2,
        decompressQueueSize: 2,
      });

      console.log('Start test');
      const queueStart = +new Date();

      for (let i = 0; i < sampleSize; i += 1) {
        const r = Math.random().toString(36);
        const compressed = await z.compressBuffer(Buffer.from(r));
        await z.decompressBuffer(compressed);
      }

      const queueTime = +new Date() - queueStart;
      const stats = z.queueStats;

      console.log(`Queue Time: ${queueTime}ms`);
      console.log(
        `Queue Stats: compress(${stats.compress.hits} hits, ${stats.compress.misses} misses), decompress(${stats.decompress.hits} hits, ${stats.decompress.misses} misses)`
      );

      const noQueueStart = +new Date();

      for (let i = 0; i < sampleSize; i += 1) {
        const r = Math.random().toString(36);
        const compressed = await compressBuffer(Buffer.from(r), 1);
        await decompressBuffer(compressed);
      }

      const noQueueTime = +new Date() - noQueueStart;

      console.log(`No Queue Time: ${noQueueTime}ms`);

      await z.destroy();

      assert.ok(
        stats.compress.hits > stats.compress.misses * 10,
        `Queue should be reused frequently: ${stats.compress.hits} hits vs ${stats.compress.misses} misses`
      );

      assert.ok(
        stats.decompress.hits > stats.decompress.misses * 10,
        `Decompress queue should be reused frequently: ${stats.decompress.hits} hits vs ${stats.decompress.misses} misses`
      );

      const performanceRatio = queueTime / noQueueTime;
      if (queueTime < noQueueTime) {
        console.log(`✓ Queue was ${((1 - performanceRatio) * 100).toFixed(1)}% faster`);
      } else {
        console.log(
          `ℹ Queue was ${((performanceRatio - 1) * 100).toFixed(
            1
          )}% slower (overhead > benefit for this workload)`
        );
      }
    }
  );
});

describe('Optional compLevel Parameter Tests', () => {
  test('should allow overriding compression level with compress()', async () => {
    const zstd = await SimpleZSTD.create({
      compressQueueSize: 2,
      compressQueue: { compLevel: 1 },
    });

    try {
      const data = Buffer.from('test data '.repeat(100));
      await zstd.compressBuffer(data);
      const statsBefore = zstd.queueStats;
      const hitsBefore = statsBefore.compress.hits;

      const compressed19 = await zstd.compressBuffer(data, 19);
      await decompressBuffer(compressed19);

      const statsAfter = zstd.queueStats;
      const hitsIncreased = statsAfter.compress.hits > hitsBefore;
      assert.ok(!hitsIncreased, 'Custom compLevel should not increment hit count');
    } finally {
      await zstd.destroy();
    }
  });

  test('should allow overriding compression level with compressBuffer()', async () => {
    const zstd = await SimpleZSTD.create({
      compressQueueSize: 1,
      compressQueue: { compLevel: 3 },
    });

    try {
      const data = Buffer.from('test data');
      const compressed3 = await zstd.compressBuffer(data);
      const compressed1 = await zstd.compressBuffer(data, 1);

      const decomp3 = await decompressBuffer(compressed3);
      const decomp1 = await decompressBuffer(compressed1);

      assert.deepEqual(decomp3, data);
      assert.deepEqual(decomp1, data);
    } finally {
      await zstd.destroy();
    }
  });
});
