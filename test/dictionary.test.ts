import { describe, test, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  SimpleZSTD,
  compressBuffer,
  decompressBuffer,
  createDictionary,
  clearDictionaryCache,
} from '../src/index';
import { dictionaryFile, trainingDirectory } from './test-helpers';

describe('Dictionary Caching Tests', () => {
  after(async () => {
    await clearDictionaryCache();
  });

  test('should cache and reuse same dictionary buffer', async () => {
    const dict = fs.readFileSync(dictionaryFile);
    const data = Buffer.from('test data');

    for (let i = 0; i < 10; i++) {
      const compressed = await compressBuffer(data, 3, { dictionary: dict });
      const decompressed = await decompressBuffer(compressed, {
        dictionary: dict,
      });
      assert.deepEqual(data, decompressed);
    }
  });

  test('should create separate cache entries for different dictionaries', async () => {
    const dict1 = fs.readFileSync(dictionaryFile);
    const dict2 = Buffer.from('different dictionary content for testing');
    const data = Buffer.from('test data');

    const compressed1 = await compressBuffer(data, 3, { dictionary: dict1 });
    await decompressBuffer(compressed1, { dictionary: dict1 });

    const compressed2 = await compressBuffer(data, 3, { dictionary: dict2 });
    await decompressBuffer(compressed2, { dictionary: dict2 });

    const compressed3 = await compressBuffer(data, 3, { dictionary: dict1 });
    await decompressBuffer(compressed3, { dictionary: dict1 });
  });

  test('should support different dictionaries for compress and decompress queues', async () => {
    const compressDict = fs.readFileSync(dictionaryFile);
    const decompressDict = fs.readFileSync(dictionaryFile);

    const zstd = await SimpleZSTD.create({
      compressQueueSize: 1,
      decompressQueueSize: 1,
      compressQueue: { compLevel: 3, dictionary: compressDict },
      decompressQueue: { dictionary: decompressDict },
    });

    try {
      const data = Buffer.from('test data');
      const compressed = await zstd.compressBuffer(data);
      const decompressed = await zstd.decompressBuffer(compressed);
      assert.deepEqual(data, decompressed);
    } finally {
      await zstd.destroy();
    }
  });
});

describe('Dictionary Creation Tests', () => {
  const listCreateRunTempDirectories = (): string[] =>
    fs
      .readdirSync(os.tmpdir())
      .filter((entry) => entry.startsWith('zstd-dict-create-run-'))
      .sort();

  test('should create a dictionary buffer from training files', async () => {
    const trainingFiles = fs
      .readdirSync(trainingDirectory)
      .filter((entry) => entry.endsWith('.json'))
      .slice(0, 50)
      .map((entry) => path.join(trainingDirectory, entry));

    const dictionaryBuffer = await createDictionary({
      trainingFiles,
      maxDictSize: 112640,
    });

    assert.ok(Buffer.isBuffer(dictionaryBuffer));
    assert.ok(dictionaryBuffer.length > 0);
  });

  test('should use created dictionary for compress/decompress round trip', async () => {
    const trainingFiles = fs
      .readdirSync(trainingDirectory)
      .filter((entry) => entry.endsWith('.json'))
      .slice(0, 75)
      .map((entry) => path.join(trainingDirectory, entry));

    const dictionaryBuffer = await createDictionary({ trainingFiles });
    const samplePayload = fs.readFileSync(path.join(trainingDirectory, 'user-149.json'));

    const compressed = await compressBuffer(samplePayload, 3, {
      dictionary: dictionaryBuffer,
    });
    const decompressed = await decompressBuffer(compressed, {
      dictionary: dictionaryBuffer,
    });

    assert.deepEqual(decompressed, samplePayload);
  });

  test('should create a dictionary from training buffers', async () => {
    const trainingBuffers = fs
      .readdirSync(trainingDirectory)
      .filter((entry) => entry.endsWith('.json'))
      .slice(0, 40)
      .map((entry) => fs.readFileSync(path.join(trainingDirectory, entry)));

    const dictionaryBuffer = await createDictionary({
      trainingFiles: trainingBuffers,
      maxDictSize: 65536,
    });

    const samplePayload = fs.readFileSync(path.join(trainingDirectory, 'user-120.json'));
    const compressed = await compressBuffer(samplePayload, 3, {
      dictionary: dictionaryBuffer,
    });
    const decompressed = await decompressBuffer(compressed, {
      dictionary: dictionaryBuffer,
    });

    assert.deepEqual(decompressed, samplePayload);
  });

  test('should reduce compressed size compared to no dictionary', async () => {
    const allTrainingFiles = fs
      .readdirSync(trainingDirectory)
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => path.join(trainingDirectory, entry));

    const dictionaryBuffer = await createDictionary({
      trainingFiles: allTrainingFiles.slice(0, 100),
      maxDictSize: 112640,
    });

    const payloadParts = allTrainingFiles
      .slice(110, 140)
      .map((filePath) => fs.readFileSync(filePath, 'utf8'));
    const payload = Buffer.from(payloadParts.join('\n'));

    const compressedWithoutDictionary = await compressBuffer(payload, 3);
    const compressedWithDictionary = await compressBuffer(payload, 3, {
      dictionary: dictionaryBuffer,
    });

    assert.ok(
      compressedWithDictionary.length < compressedWithoutDictionary.length,
      `Expected dictionary compression to be smaller: with dictionary=${compressedWithDictionary.length}, without dictionary=${compressedWithoutDictionary.length}`
    );
  });

  test('should support mixed training inputs and clean only staged temp files', async () => {
    const tempDirsBefore = listCreateRunTempDirectories();
    const directTrainingFile = path.join(trainingDirectory, 'user-0.json');
    const originalDirectFileContents = fs.readFileSync(directTrainingFile);
    const pathInputs = fs
      .readdirSync(trainingDirectory)
      .filter((entry) => entry.endsWith('.json'))
      .slice(0, 60)
      .map((entry) => path.join(trainingDirectory, entry));
    const bufferInputs = fs
      .readdirSync(trainingDirectory)
      .filter((entry) => entry.endsWith('.json'))
      .slice(60, 90)
      .map((entry) => fs.readFileSync(path.join(trainingDirectory, entry)));

    const dictionaryBuffer = await createDictionary({
      trainingFiles: [...pathInputs, ...bufferInputs],
      maxDictSize: 32768,
    });

    const tempDirsAfter = listCreateRunTempDirectories();

    assert.ok(Buffer.isBuffer(dictionaryBuffer));
    assert.ok(dictionaryBuffer.length > 0);
    assert.ok(fs.existsSync(directTrainingFile), 'Direct training file should not be deleted');
    assert.deepEqual(
      fs.readFileSync(directTrainingFile),
      originalDirectFileContents,
      'Direct training file should not be modified'
    );
    assert.deepEqual(
      tempDirsAfter,
      tempDirsBefore,
      'Per-run temp directory should be cleaned up after dictionary creation'
    );
  });
});
