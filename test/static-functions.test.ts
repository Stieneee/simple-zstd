import { describe, test, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';

import { compress, decompress, compressBuffer, decompressBuffer, clearDictionaryCache } from '../src/index';
import {
  createThrottle,
  assertFileEqual,
  sourceFile,
  dictionaryFile,
  createTestOutputPaths,
  cleanupOutputPaths,
} from './test-helpers';

const { dst1, dst2, dstZstd1, dstZstd2 } = createTestOutputPaths('static-functions');

describe('Test simple-zstd Static Functions', () => {
  before(() => {
    cleanupOutputPaths([dst1, dst2, dstZstd1, dstZstd2]);
  });

  after(async () => {
    await clearDictionaryCache();
  });

  test('should not alter the file', async () => {
    const c = await compress(3);
    const d = await decompress();

    return new Promise((resolve, reject) => {
      fs.createReadStream(sourceFile)
        .pipe(c)
        .pipe(d)
        .pipe(fs.createWriteStream(dst1))
        .on('error', (err) => {
          c.destroy();
          d.destroy();
          reject(err);
        })
        .on('finish', () => {
          try {
            assertFileEqual(sourceFile, dst1);
            c.destroy();
            d.destroy();
            resolve();
          } catch (err) {
            c.destroy();
            d.destroy();
            reject(err);
          }
        });
    });
  });

  test('should perform correctly with stream.pipeline', async () => {
    const c = await compress(3);
    const d = await decompress();

    await pipeline(fs.createReadStream(sourceFile), c, d, fs.createWriteStream(dst1));
    assertFileEqual(sourceFile, dst1);
  });

  test('should handle back pressure', { timeout: 30000 }, async () => {
    const c = await compress(3);
    const d = await decompress();

    await pipeline(
      fs.createReadStream(sourceFile),
      c,
      d,
      createThrottle(200000),
      fs.createWriteStream(dst1)
    );

    assertFileEqual(sourceFile, dst1);
  });

  test('compression level should change compression', { timeout: 5000 }, async () => {
    const c1 = await compress(1, {});
    const c2 = await compress(19, {});

    await pipeline(fs.createReadStream(sourceFile), c1, fs.createWriteStream(dstZstd1));
    await pipeline(fs.createReadStream(sourceFile), c2, fs.createWriteStream(dstZstd2));

    if (fs.statSync(dstZstd2).size >= fs.statSync(dstZstd1).size) {
      throw new Error('Compression level failed');
    }
  });

  test('should accept zstdOptions - ultra option', { timeout: 30000 }, async () => {
    const c1 = await compress(1);
    const c2 = await compress(22, { zstdOptions: ['--ultra'] });

    await pipeline(fs.createReadStream(sourceFile), c1, fs.createWriteStream(dstZstd1));
    await pipeline(fs.createReadStream(sourceFile), c2, fs.createWriteStream(dstZstd2));

    if (fs.statSync(dstZstd2).size >= fs.statSync(dstZstd1).size) {
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
    const buffer = fs.readFileSync(sourceFile);
    const compressed = await compressBuffer(buffer, 3);
    const decompressed = await decompressBuffer(compressed);
    assert.deepEqual(buffer, decompressed);
  });

  test('should accept a dictionary file as a buffer', async () => {
    const buffer = fs.readFileSync(sourceFile);
    const dictBuffer = fs.readFileSync(dictionaryFile);

    const compressed = await compressBuffer(buffer, 3, {
      dictionary: dictBuffer,
    });
    const decompressed = await decompressBuffer(compressed, {
      dictionary: dictBuffer,
    });

    assert.deepEqual(buffer, decompressed);
  });

  test('should accept a dictionary file as a path', async () => {
    const buffer = fs.readFileSync(sourceFile);

    const compressed = await compressBuffer(buffer, 3, {
      dictionary: { path: dictionaryFile },
    });
    const decompressed = await decompressBuffer(compressed, {
      dictionary: { path: dictionaryFile },
    });

    assert.deepEqual(buffer, decompressed);
  });
});
