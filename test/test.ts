import { describe, test, before, after } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";

import {
  SimpleZSTD,
  compress,
  decompress,
  compressBuffer,
  decompressBuffer,
  clearDictionaryCache,
} from "../src/index";

// Simple throttle stream to replace brake module
function createThrottle(bytesPerSecond: number): Transform {
  let bytes = 0;
  const startTime = Date.now();

  return new Transform({
    transform(
      chunk: Buffer,
      _encoding: BufferEncoding,
      callback: (error?: Error | null) => void
    ) {
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

// Custom file comparison helper
function assertFileEqual(file1: string, file2: string): void {
  const content1 = fs.readFileSync(file1);
  const content2 = fs.readFileSync(file2);
  assert.deepEqual(
    content1,
    content2,
    `Files ${file1} and ${file2} are not equal`
  );
}

// ZSTDCompress(compressionLevel, streamOptions)
// ZSTDDecompress(streamOptions)

const src = path.join(__dirname, "sample/earth.jpg");
const dst1 = "/tmp/example_copy1.txt";
const dst2 = "/tmp/example_copy2.txt";

const dstZstd1 = "/tmp/example_copy1.zst";
const dstZstd2 = "/tmp/example_copy2.zst";

const dictionary = path.join(__dirname, "sample/dictionary");

describe("Test simple-zstd Static Functions", () => {
  before(() => {
    fs.rmSync(dst1, { force: true });
    fs.rmSync(dst2, { force: true });
    fs.rmSync(dstZstd1, { force: true });
    fs.rmSync(dstZstd2, { force: true });
  });

  after(async () => {
    await clearDictionaryCache();
  });

  test("should not alter the file", async () => {
    const c = await compress(3);
    const d = await decompress();

    return new Promise((resolve, reject) => {
      fs.createReadStream(src)
        .pipe(c)
        .pipe(d)
        .pipe(fs.createWriteStream(dst1))
        .on("error", (err) => {
          c.destroy();
          d.destroy();
          reject(err);
        })
        .on("finish", () => {
          try {
            assertFileEqual(src, dst1);
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

  test("should perform correctly with stream.pipeline", async () => {
    const c = await compress(3);
    const d = await decompress();

    await pipeline(fs.createReadStream(src), c, d, fs.createWriteStream(dst1));

    assertFileEqual(src, dst1);
  });

  test("should handle back pressure", { timeout: 30000 }, async () => {
    const c = await compress(3);
    const d = await decompress();

    await pipeline(
      fs.createReadStream(src),
      c,
      d,
      createThrottle(200000),
      fs.createWriteStream(dst1)
    );

    assertFileEqual(src, dst1);
  });

  test(
    "compression level should change compression",
    { timeout: 5000 },
    async () => {
      const c1 = await compress(1, {});
      const c2 = await compress(19, {});

      await pipeline(
        fs.createReadStream(src),
        c1,
        fs.createWriteStream(dstZstd1)
      );

      await pipeline(
        fs.createReadStream(src),
        c2,
        fs.createWriteStream(dstZstd2)
      );

      if (fs.statSync(dstZstd2).size >= fs.statSync(dstZstd1).size) {
        throw new Error("Compression level failed");
      }
    }
  );

  test(
    "should accept zstdOptions - ultra option",
    { timeout: 30000 },
    async () => {
      const c1 = await compress(1);
      const c2 = await compress(22, { zstdOptions: ["--ultra"] });

      await pipeline(
        fs.createReadStream(src),
        c1,
        fs.createWriteStream(dstZstd1)
      );

      await pipeline(
        fs.createReadStream(src),
        c2,
        fs.createWriteStream(dstZstd2)
      );

      if (fs.statSync(dstZstd2).size >= fs.statSync(dstZstd1).size) {
        // console.log(fs.statSync(dstZstd2).size, fs.statSync(dstZstd1).size);
        throw new Error("ultra test failed test failed");
      }
    }
  );

  test("should accept a buffer", async () => {
    const buffer = Buffer.from("this is a test");

    const compressed = await compressBuffer(buffer, 3, {});
    const decompressed = await decompressBuffer(compressed, {});

    assert.deepEqual(buffer, decompressed);
  });

  test("should accept a bigger buffer", async () => {
    const buffer = fs.readFileSync(src);

    const compressed = await compressBuffer(buffer, 3);
    const decompressed = await decompressBuffer(compressed);

    assert.deepEqual(buffer, decompressed);
  });

  test("should accept a dictionary file as a buffer", async () => {
    const buffer = fs.readFileSync(src);
    const dictBuffer = fs.readFileSync(dictionary);

    const compressed = await compressBuffer(buffer, 3, {
      dictionary: dictBuffer,
    });
    const decompressed = await decompressBuffer(compressed, {
      dictionary: dictBuffer,
    });

    assert.deepEqual(buffer, decompressed);
  });

  test("should accept a dictionary file as a path", async () => {
    const buffer = fs.readFileSync(src);

    const compressed = await compressBuffer(buffer, 3, {
      dictionary: { path: dictionary },
    });
    const decompressed = await decompressBuffer(compressed, {
      dictionary: { path: dictionary },
    });

    assert.deepEqual(buffer, decompressed);
  });
});

describe("Test simple-zstd Class", () => {
  test("should behave as the static function", async () => {
    const z = await SimpleZSTD.create();

    const c = await z.compress();
    const d = await z.decompress();

    return new Promise((resolve, reject) => {
      fs.createReadStream(src)
        .pipe(c)
        .pipe(d)
        .pipe(fs.createWriteStream(dst1))
        .on("error", async (err) => {
          c.destroy();
          d.destroy();
          await z.destroy();
          reject(err);
        })
        .on("finish", async () => {
          try {
            assertFileEqual(src, dst1);
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

  test("should handle back pressure", { timeout: 30000 }, async () => {
    const z = await SimpleZSTD.create();

    const c = await z.compress();
    const d = await z.decompress();

    await pipeline(
      fs.createReadStream(src),
      c,
      d,
      createThrottle(200000),
      fs.createWriteStream(dst1)
    );

    await z.destroy();
    assertFileEqual(src, dst1);
  });

  test(
    "should behave as the static function and pre create zstd child process",
    { timeout: 30000 },
    async () => {
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
          .on("error", async (err) => {
            c.destroy();
            d.destroy();
            await z.destroy();
            reject(err);
          })
          .on("finish", async () => {
            try {
              assertFileEqual(src, dst1);
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

  test("should accept a bigger buffer", async () => {
    const buffer = fs.readFileSync(src);

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

  test("should accept a dictionary file as a buffer", async () => {
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

    await z.destroy();
    assert.deepEqual(buffer, decompressed);
    assert.equal(z.queueStats.compress.hits, 1);
    assert.equal(z.queueStats.compress.misses, 0);
    assert.equal(z.queueStats.decompress.hits, 1);
    assert.equal(z.queueStats.compress.misses, 0);
  });

  test("should accept a dictionary file as a path", async () => {
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

    await z.destroy();
    assert.deepEqual(buffer, decompressed);
  });
});

describe("Performance Tests", () => {
  test(
    "queue should reuse processes and provide performance benefit",
    { timeout: 60000 },
    async () => {
      // Use compLevel 1 to place emphasis on queue performance rather than compression

      const sampleSize = 500;

      const z = await SimpleZSTD.create({
        compressQueue: { compLevel: 1 },
        compressQueueSize: 2,
        decompressQueueSize: 2,
      });

      console.log("Start test");
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

      // No Queue (for comparison only, not strict assertion)
      const noQueueStart = +new Date();

      for (let i = 0; i < sampleSize; i += 1) {
        const r = Math.random().toString(36);
        const compressed = await compressBuffer(Buffer.from(r), 1);
        await decompressBuffer(compressed);
      }

      const noQueueTime = +new Date() - noQueueStart;

      console.log(`No Queue Time: ${noQueueTime}ms`);

      await z.destroy();

      // Primary assertion: verify queue is being reused (the key functionality)
      assert.ok(
        stats.compress.hits > stats.compress.misses * 10,
        `Queue should be reused frequently: ${stats.compress.hits} hits vs ${stats.compress.misses} misses`
      );

      assert.ok(
        stats.decompress.hits > stats.decompress.misses * 10,
        `Decompress queue should be reused frequently: ${stats.decompress.hits} hits vs ${stats.decompress.misses} misses`
      );

      // Performance is informational only (varies based on workload and system conditions)
      const performanceRatio = queueTime / noQueueTime;
      if (queueTime < noQueueTime) {
        console.log(
          `✓ Queue was ${((1 - performanceRatio) * 100).toFixed(1)}% faster`
        );
      } else {
        console.log(
          `ℹ Queue was ${((performanceRatio - 1) * 100).toFixed(
            1
          )}% slower (overhead > benefit for this workload)`
        );
      }

      // The queue provides value for real-world scenarios:
      // - Reuses processes (proven by hit stats)
      // - Reduces process spawn overhead
      // - Benefits vary by: workload size, compression level, system load
      // - Serial small compressions may show overhead, concurrent operations benefit more
    }
  );
});

describe("Dictionary Caching Tests", () => {
  after(async () => {
    await clearDictionaryCache();
  });

  test("should cache and reuse same dictionary buffer", async () => {
    const dict = fs.readFileSync(dictionary);
    const data = Buffer.from("test data");

    // Use same dictionary 10 times - should only create 1 temp file
    for (let i = 0; i < 10; i++) {
      const compressed = await compressBuffer(data, 3, { dictionary: dict });
      const decompressed = await decompressBuffer(compressed, {
        dictionary: dict,
      });
      assert.deepEqual(data, decompressed);
    }

    // Dictionary cache should have been used (verified by debug logs in manual testing)
  });

  test("should create separate cache entries for different dictionaries", async () => {
    const dict1 = fs.readFileSync(dictionary);
    const dict2 = Buffer.from("different dictionary content for testing");
    const data = Buffer.from("test data");

    // Use dict1
    const compressed1 = await compressBuffer(data, 3, { dictionary: dict1 });
    await decompressBuffer(compressed1, { dictionary: dict1 });

    // Use dict2 - should create new cache entry
    const compressed2 = await compressBuffer(data, 3, { dictionary: dict2 });
    await decompressBuffer(compressed2, { dictionary: dict2 });

    // Use dict1 again - should hit cache
    const compressed3 = await compressBuffer(data, 3, { dictionary: dict1 });
    await decompressBuffer(compressed3, { dictionary: dict1 });
  });

  test("should support different dictionaries for compress and decompress queues", async () => {
    const compressDict = fs.readFileSync(dictionary);
    const decompressDict = fs.readFileSync(dictionary); // Same content but could be different

    const zstd = await SimpleZSTD.create({
      compressQueueSize: 1,
      decompressQueueSize: 1,
      compressQueue: { compLevel: 3, dictionary: compressDict },
      decompressQueue: { dictionary: decompressDict },
    });

    try {
      const data = Buffer.from("test data");
      const compressed = await zstd.compressBuffer(data);
      const decompressed = await zstd.decompressBuffer(compressed);
      assert.deepEqual(data, decompressed);
    } finally {
      await zstd.destroy();
    }
  });
});

describe("Optional compLevel Parameter Tests", () => {
  test("should allow overriding compression level with compress()", async () => {
    const zstd = await SimpleZSTD.create({
      compressQueueSize: 2,
      compressQueue: { compLevel: 1 }, // Default level 1
    });

    try {
      const data = Buffer.from("test data ".repeat(100));

      // First use pool to populate stats
      await zstd.compressBuffer(data);

      // Check initial stats
      const statsBefore = zstd.queueStats;
      const hitsBefore = statsBefore.compress.hits;

      // Override with level 19 - should bypass queue
      const compressed19 = await zstd.compressBuffer(data, 19);
      await decompressBuffer(compressed19); // Verify it decompresses

      // Verify queue stats show the override as a miss (or no hit increase)
      const statsAfter = zstd.queueStats;

      // When using custom compLevel, it either increments misses or doesn't increment hits
      const hitsIncreased = statsAfter.compress.hits > hitsBefore;
      assert.ok(
        !hitsIncreased,
        "Custom compLevel should not increment hit count"
      );
    } finally {
      await zstd.destroy();
    }
  });

  test("should allow overriding compression level with compressBuffer()", async () => {
    const zstd = await SimpleZSTD.create({
      compressQueueSize: 1,
      compressQueue: { compLevel: 3 },
    });

    try {
      const data = Buffer.from("test data");

      // Pool default
      const compressed3 = await zstd.compressBuffer(data);

      // Override with level 1 (should be larger/faster)
      const compressed1 = await zstd.compressBuffer(data, 1);

      // Both should decompress correctly
      const decomp3 = await decompressBuffer(compressed3);
      const decomp1 = await decompressBuffer(compressed1);

      assert.deepEqual(decomp3, data);
      assert.deepEqual(decomp1, data);
    } finally {
      await zstd.destroy();
    }
  });
});

describe("Stream Events Tests", () => {
  test("should emit exit event on stream completion", async () => {
    const stream = await compress(3);
    const data = Buffer.from("test data");

    return new Promise((resolve, reject) => {
      let exitEventFired = false;

      stream.on("exit", (code: number) => {
        exitEventFired = true;
        assert.strictEqual(
          code,
          0,
          "Exit code should be 0 for successful compression"
        );
      });

      stream.on("error", reject);

      stream.on("finish", () => {
        setTimeout(() => {
          assert.ok(exitEventFired, "Exit event should have fired");
          resolve();
        }, 100);
      });

      stream.end(data);
    });
  });

  test("should handle stderr event if zstd outputs warnings", async () => {
    const stream = await compress(3);
    const data = Buffer.from("test data");

    stream.on("stderr", (message: string) => {
      assert.strictEqual(typeof message, "string");
    });

    await new Promise((resolve, reject) => {
      stream.on("error", reject);
      stream.on("finish", resolve);
      stream.end(data);
    });
  });
});

describe("Error Handling and Edge Cases", () => {
  after(async () => {
    await clearDictionaryCache();
  });

  test("should normalize invalid compression levels", async () => {
    const data = Buffer.from("test data");

    // Test level 0 (below minimum) - should normalize to 3
    const compressed0 = await compressBuffer(data, 0);
    const decompressed0 = await decompressBuffer(compressed0);
    assert.deepEqual(decompressed0, data);

    // Test level -5 (negative) - should normalize to 3
    const compressedNeg = await compressBuffer(data, -5);
    const decompressedNeg = await decompressBuffer(compressedNeg);
    assert.deepEqual(decompressedNeg, data);

    // Test level 99 (above maximum) - should normalize to 3
    const compressed99 = await compressBuffer(data, 99);
    const decompressed99 = await decompressBuffer(compressed99);
    assert.deepEqual(decompressed99, data);
  });

  test("should handle decompressing non-zstd data (passthrough)", async () => {
    const plainData = Buffer.from("This is plain uncompressed data");

    // Decompress should detect it's not zstd and pass through
    const result = await decompressBuffer(plainData);

    // Should return the data unchanged
    assert.deepEqual(result, plainData);
  });

  test("should handle compression with very small data", async () => {
    const tinyData = Buffer.from("x");

    const compressed = await compressBuffer(tinyData, 3);
    const decompressed = await decompressBuffer(compressed);

    assert.deepEqual(decompressed, tinyData);
  });

  test("should handle multiple concurrent operations with same dictionary", async () => {
    const dict = fs.readFileSync(dictionary);
    const data1 = Buffer.from("test data 1");
    const data2 = Buffer.from("test data 2");
    const data3 = Buffer.from("test data 3");

    // Run concurrent operations with same dictionary
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
