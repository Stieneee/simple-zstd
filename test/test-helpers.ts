import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Transform } from 'node:stream';

export const sourceFile = path.join(__dirname, 'sample/earth.jpg');
export const dictionaryFile = path.join(__dirname, 'sample/dictionary');
export const trainingDirectory = path.join(__dirname, 'sample/training-files');

export function createThrottle(bytesPerSecond: number): Transform {
  let bytes = 0;
  const startTime = Date.now();

  return new Transform({
    transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
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
    },
  });
}

export function assertFileEqual(file1: string, file2: string): void {
  const content1 = fs.readFileSync(file1);
  const content2 = fs.readFileSync(file2);
  assert.deepEqual(content1, content2, `Files ${file1} and ${file2} are not equal`);
}

export function createTestOutputPaths(prefix: string): {
  dst1: string;
  dst2: string;
  dstZstd1: string;
  dstZstd2: string;
} {
  const runId = `${process.pid}-${prefix}`;
  return {
    dst1: path.join(os.tmpdir(), `simple-zstd-${runId}-copy-1.txt`),
    dst2: path.join(os.tmpdir(), `simple-zstd-${runId}-copy-2.txt`),
    dstZstd1: path.join(os.tmpdir(), `simple-zstd-${runId}-copy-1.zst`),
    dstZstd2: path.join(os.tmpdir(), `simple-zstd-${runId}-copy-2.zst`),
  };
}

export function cleanupOutputPaths(pathsToRemove: string[]): void {
  for (const outputPath of pathsToRemove) {
    fs.rmSync(outputPath, { force: true });
  }
}
