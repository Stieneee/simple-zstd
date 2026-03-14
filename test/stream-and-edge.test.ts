import { describe, test, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

import { compress, compressBuffer, decompressBuffer, clearDictionaryCache } from '../src/index';
import { dictionaryFile } from './test-helpers';

describe('Stream Events Tests', () => {
  test('should emit exit event on stream completion', async () => {
    const stream = await compress(3);
    const data = Buffer.from('test data');

    return new Promise((resolve, reject) => {
      let exitEventFired = false;

      stream.on('exit', (code: number) => {
        exitEventFired = true;
        assert.strictEqual(code, 0, 'Exit code should be 0 for successful compression');
      });

      stream.on('error', reject);

      stream.on('finish', () => {
        setTimeout(() => {
          assert.ok(exitEventFired, 'Exit event should have fired');
          resolve();
        }, 100);
      });

      stream.end(data);
    });
  });

  test('should handle stderr event if zstd outputs warnings', async () => {
    const stream = await compress(3);
    const data = Buffer.from('test data');

    stream.on('stderr', (message: string) => {
      assert.strictEqual(typeof message, 'string');
    });

    await new Promise((resolve, reject) => {
      stream.on('error', reject);
      stream.on('finish', resolve);
      stream.end(data);
    });
  });
});

describe('Error Handling and Edge Cases', () => {
  after(async () => {
    await clearDictionaryCache();
  });

  test('should normalize invalid compression levels', async () => {
    const data = Buffer.from('test data');

    const compressed0 = await compressBuffer(data, 0);
    const decompressed0 = await decompressBuffer(compressed0);
    assert.deepEqual(decompressed0, data);

    const compressedNeg = await compressBuffer(data, -5);
    const decompressedNeg = await decompressBuffer(compressedNeg);
    assert.deepEqual(decompressedNeg, data);

    const compressed99 = await compressBuffer(data, 99);
    const decompressed99 = await decompressBuffer(compressed99);
    assert.deepEqual(decompressed99, data);
  });

  test('should handle decompressing non-zstd data (passthrough)', async () => {
    const plainData = Buffer.from('This is plain uncompressed data');
    const result = await decompressBuffer(plainData);
    assert.deepEqual(result, plainData);
  });

  test('should handle compression with very small data', async () => {
    const tinyData = Buffer.from('x');
    const compressed = await compressBuffer(tinyData, 3);
    const decompressed = await decompressBuffer(compressed);
    assert.deepEqual(decompressed, tinyData);
  });

  test('should handle multiple concurrent operations with same dictionary', async () => {
    const dict = fs.readFileSync(dictionaryFile);
    const data1 = Buffer.from('test data 1');
    const data2 = Buffer.from('test data 2');
    const data3 = Buffer.from('test data 3');

    const results = await Promise.all([
      compressBuffer(data1, 3, { dictionary: dict }).then((c) =>
        decompressBuffer(c, { dictionary: dict })
      ),
      compressBuffer(data2, 3, { dictionary: dict }).then((c) =>
        decompressBuffer(c, { dictionary: dict })
      ),
      compressBuffer(data3, 3, { dictionary: dict }).then((c) =>
        decompressBuffer(c, { dictionary: dict })
      ),
    ]);

    assert.deepEqual(results[0], data1);
    assert.deepEqual(results[1], data2);
    assert.deepEqual(results[2], data3);
  });
});
