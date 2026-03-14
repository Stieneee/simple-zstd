import { describe, test, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable, Writable } from 'node:stream';

import {
  compress,
  decompress,
  compressBuffer,
  decompressBuffer,
  clearDictionaryCache,
} from '../src/index';

describe('decompressBuffer dictionary error behavior', () => {
  test('should reject dictionary-compressed input when dictionary is missing', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'simple-zstd-repro-'));

    try {
      const dictPath = path.join(tempRoot, 'raw-content.dict');
      fs.writeFileSync(dictPath, 'alpha beta gamma delta');
      const payload = Buffer.from('alpha beta gamma');

      const compressedResult = spawnSync('zstd', ['-q', '-c', '-D', dictPath, '-3', '--no-check'], {
        input: payload,
      });
      assert.equal(
        compressedResult.status,
        0,
        `zstd compress failed: ${compressedResult.stderr?.toString() ?? ''}`
      );
      const compressed = compressedResult.stdout;

      const baselineDecode = spawnSync('zstd', ['-q', '-d', '-c'], { input: compressed });
      assert.notEqual(
        baselineDecode.status,
        0,
        'Expected raw zstd CLI decode to fail without dictionary'
      );

      await assert.rejects(async () => {
        await decompressBuffer(compressed);
      });
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('should decode dictionary-compressed input when dictionary is provided', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'simple-zstd-repro-'));

    try {
      const dictPath = path.join(tempRoot, 'raw-content.dict');
      fs.writeFileSync(dictPath, 'alpha beta gamma delta');
      const payload = Buffer.from('alpha beta gamma');

      const compressedResult = spawnSync('zstd', ['-q', '-c', '-D', dictPath, '-3', '--no-check'], {
        input: payload,
      });
      assert.equal(
        compressedResult.status,
        0,
        `zstd compress failed: ${compressedResult.stderr?.toString() ?? ''}`
      );

      const decoded = await decompressBuffer(compressedResult.stdout, {
        dictionary: { path: dictPath },
      });
      assert.deepEqual(decoded, payload);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

describe('Failure propagation tests', () => {
  after(async () => {
    await clearDictionaryCache();
  });

  test('compressBuffer should reject when dictionary path is missing', async () => {
    await assert.rejects(async () => {
      await compressBuffer(Buffer.from('will fail'), 3, {
        dictionary: { path: '/tmp/does-not-exist-simple-zstd.dict' },
      });
    });
  });

  test('compressBuffer should reject with invalid zstd option', async () => {
    await assert.rejects(async () => {
      await compressBuffer(Buffer.from('will fail'), 3, {
        zstdOptions: ['--definitely-invalid-option'],
      });
    });
  });

  test('compress stream should reject with invalid zstd option', async () => {
    const c = await compress(3, {
      zstdOptions: ['--definitely-invalid-option'],
    });

    await assert.rejects(async () => {
      await pipeline(
        Readable.from(Buffer.from('stream failure')),
        c,
        new Writable({
          write(_chunk, _encoding, callback) {
            callback();
          },
        })
      );
    });
  });

  test('decompressBuffer should reject truncated zstd frame', async () => {
    const payload = Buffer.from('truncation-check'.repeat(200));
    const compressed = await compressBuffer(payload, 3);
    const truncated = compressed.slice(0, Math.max(0, compressed.length - 5));

    await assert.rejects(async () => {
      await decompressBuffer(truncated);
    });
  });

  test('decompress stream should reject dictionary-compressed input without dictionary', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'simple-zstd-stream-repro-'));

    try {
      const dictPath = path.join(tempRoot, 'raw-content.dict');
      fs.writeFileSync(dictPath, 'alpha beta gamma delta');
      const payload = Buffer.from('alpha beta gamma');

      const compressedResult = spawnSync('zstd', ['-q', '-c', '-D', dictPath, '-3', '--no-check'], {
        input: payload,
      });
      assert.equal(
        compressedResult.status,
        0,
        `zstd compress failed: ${compressedResult.stderr?.toString() ?? ''}`
      );

      const d = await decompress();

      await assert.rejects(async () => {
        await pipeline(
          Readable.from(compressedResult.stdout),
          d,
          new Writable({
            write(_chunk, _encoding, callback) {
              callback();
            },
          })
        );
      });
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
