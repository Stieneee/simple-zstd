# simple-zstd

[![Build Status](https://travis-ci.org/Stieneee/simple-zstd.svg?branch=master)](https://travis-ci.org/Stieneee/simple-zstd)
[![License](https://badgen.net/badge/license/MIT/blue)](https://choosealicense.com/licenses/mit/)

Node.js interface to system-installed Zstandard (zstd) with TypeScript support.

## Overview

simple-zstd is a lightweight wrapper around the system-installed zstd binary, inspired by simple-git's approach of wrapping system binaries rather than building against native libraries. This provides a more stable and portable solution at the cost of requiring zstd to be installed on the system.

### Features

- **TypeScript Support**: Full TypeScript definitions and modern ES modules
- **Multiple Interfaces**: Static functions, buffer methods, and class-based API with process pooling
- **Promise-Based**: All operations return promises for modern async/await patterns
- **Stream & Buffer**: Support for both streaming and buffer-based compression/decompression
- **Smart Decompression**: Automatic detection and passthrough of non-compressed data
- **Dictionary Support**: Use compression dictionaries via Buffer or file path
- **Process Pooling**: Pre-spawn child processes for latency-sensitive applications
- **Node.js 18+**: Built on modern Node.js features

## Requirements

- **Node.js**: >= 18.0.0
- **zstd**: Must be installed and available on system PATH

## Installation

### Install zstd

**Ubuntu/Debian:**

```bash
sudo apt install zstd
```

**macOS:**

```bash
brew install zstd
```

**Windows:**

```bash
choco install zstd
# or download from: https://github.com/facebook/zstd/releases
```

### Install simple-zstd

```bash
npm install simple-zstd
```

## API Reference

### Types

```typescript
import { Duplex } from "node:stream";
import { SpawnOptions } from "node:child_process";
import { DuplexOptions } from "node:stream";

interface ZSTDOpts {
  dictionary?: Buffer | { path: string }; // Compression dictionary
  zstdOptions?: string[]; // CLI args to pass to zstd (e.g., ['--ultra'])
  spawnOptions?: SpawnOptions; // Node.js child_process spawn options
  streamOptions?: DuplexOptions; // Node.js stream options
}

interface PoolOpts {
  compressQueueSize?: number; // Number of pre-spawned compression processes
  decompressQueueSize?: number; // Number of pre-spawned decompression processes
  compressQueue?: {
    compLevel?: number;
    dictionary?: Buffer | { path: string };
    zstdOptions?: string[];
    spawnOptions?: SpawnOptions;
    streamOptions?: DuplexOptions;
  };
  decompressQueue?: {
    dictionary?: Buffer | { path: string };
    zstdOptions?: string[];
    spawnOptions?: SpawnOptions;
    streamOptions?: DuplexOptions;
  };
}
```

### Static Functions

```typescript
// Compression
compress(compLevel: number, opts?: ZSTDOpts): Promise<Duplex>
compressBuffer(buffer: Buffer, compLevel: number, opts?: ZSTDOpts): Promise<Buffer>

// Decompression (with automatic passthrough for non-compressed data)
decompress(opts?: ZSTDOpts): Promise<Duplex>
decompressBuffer(buffer: Buffer, opts?: ZSTDOpts): Promise<Buffer>
```

### Class: SimpleZSTD

The `SimpleZSTD` class provides process pooling for better performance when performing many compression/decompression operations.

```typescript
class SimpleZSTD {
  // Static factory method (recommended)
  static create(poolOptions?: PoolOpts): Promise<SimpleZSTD>;

  // Instance methods
  compress(compLevel?: number): Promise<Duplex>;
  compressBuffer(buffer: Buffer, compLevel?: number): Promise<Buffer>;
  decompress(): Promise<Duplex>;
  decompressBuffer(buffer: Buffer): Promise<Buffer>;
  destroy(): void;

  // Statistics
  get queueStats(): {
    compress: { hits: number; misses: number };
    decompress: { hits: number; misses: number };
  };
}
```

**Note:** Use the static `create()` method instead of the constructor. The constructor is private to ensure proper async initialization.

## Usage

### Example 1: Stream Interface (TypeScript)

```typescript
import fs from "node:fs";
import { pipeline } from "node:stream/promises";
import { compress, decompress } from "simple-zstd";

async function copyFile() {
  const c = await compress(3); // Compression level 3
  const d = await decompress();

  await pipeline(
    fs.createReadStream("example.txt"),
    c,
    d,
    fs.createWriteStream("example_copy.txt")
  );

  console.log("File compressed and decompressed!");
}

copyFile().catch(console.error);
```

### Example 2: Buffer Interface (TypeScript)

```typescript
import { compressBuffer, decompressBuffer } from "simple-zstd";

async function processBuffer() {
  const buffer = Buffer.from("this is a test");

  // Compress with level 3
  const compressed = await compressBuffer(buffer, 3);
  console.log(
    `Original: ${buffer.length} bytes, Compressed: ${compressed.length} bytes`
  );

  // Decompress
  const decompressed = await decompressBuffer(compressed);
  console.log(decompressed.toString()); // "this is a test"
}

processBuffer().catch(console.error);
```

### Example 3: CommonJS Usage

```javascript
const fs = require("fs");
const { pipeline } = require("node:stream/promises");
const { compress, decompress } = require("simple-zstd");

async function copyFile() {
  const c = await compress(3);
  const d = await decompress();

  await pipeline(
    fs.createReadStream("example.txt"),
    c,
    d,
    fs.createWriteStream("example_copy.txt")
  );

  console.log("File compressed and decompressed!");
}

copyFile().catch(console.error);
```

### Example 4: Class Interface with Process Pooling

The `SimpleZSTD` class pre-spawns zstd processes for lower latency. This is ideal for high-throughput scenarios.

```typescript
import fs from "node:fs";
import { pipeline } from "node:stream/promises";
import { SimpleZSTD } from "simple-zstd";

async function processMultipleFiles() {
  // Create instance with process pools using static factory method
  const zstd = await SimpleZSTD.create({
    compressQueueSize: 2, // Pre-spawn 2 compression processes
    decompressQueueSize: 2, // Pre-spawn 2 decompression processes
    compressQueue: {
      compLevel: 3, // Default compression level for pool
    },
  });

  try {
    // Process first file with pool default (level 3)
    const c1 = await zstd.compress();
    const d1 = await zstd.decompress();

    await pipeline(
      fs.createReadStream("file1.txt"),
      c1,
      d1,
      fs.createWriteStream("file1_copy.txt")
    );

    console.log("File 1 processed!");

    // Process second file with custom compression level (bypasses pool)
    const c2 = await zstd.compress(19); // Override with level 19
    const d2 = await zstd.decompress();

    await pipeline(
      fs.createReadStream("file2.txt"),
      c2,
      d2,
      fs.createWriteStream("file2_copy.txt")
    );

    console.log("File 2 processed!");

    // Check pool statistics
    console.log("Pool stats:", zstd.queueStats);
    // Example output: { compress: { hits: 1, misses: 1 }, decompress: { hits: 2, misses: 0 } }
    // Note: compress shows 1 miss because we used custom level for file2
  } finally {
    // Clean up all child processes
    zstd.destroy();
  }
}

processMultipleFiles().catch(console.error);
```

### Example 5: Using Compression Dictionaries

```typescript
import fs from "node:fs";
import { compressBuffer, decompressBuffer, SimpleZSTD } from "simple-zstd";

// Static functions with dictionaries
async function useDictionaryStatic() {
  const dictionary = fs.readFileSync("my-dictionary.zstd");
  const data = Buffer.from("Sample text to compress");

  // Compress with dictionary
  const compressed = await compressBuffer(data, 3, { dictionary });

  // Decompress with same dictionary
  const decompressed = await decompressBuffer(compressed, { dictionary });

  console.log(decompressed.toString()); // "Sample text to compress"
}

// Class with dictionaries (supports Buffer or file path)
async function useDictionaryClass() {
  const dictionary = fs.readFileSync("my-dictionary.zstd");

  const zstd = await SimpleZSTD.create({
    compressQueue: {
      compLevel: 3,
      dictionary, // Can be Buffer or { path: '/path/to/dict' }
    },
    decompressQueue: {
      dictionary, // Same dictionary for decompression
    },
  });

  try {
    const data = Buffer.from("Sample text to compress");
    const compressed = await zstd.compressBuffer(data);
    const decompressed = await zstd.decompressBuffer(compressed);
    console.log(decompressed.toString()); // "Sample text to compress"
  } finally {
    zstd.destroy();
  }
}

useDictionaryStatic().catch(console.error);
```

**Dictionary Caching:** When using dictionary Buffers with static functions, simple-zstd automatically caches the temporary dictionary files using SHA-256 hashing. This means:
- ✅ Multiple calls with the **same dictionary Buffer** reuse the same temp file
- ✅ No performance penalty for repeated operations with dictionaries
- ✅ Automatic cleanup when the dictionary is no longer in use
- ✅ **Fixes exponential slowdown** when compressing thousands of items with dictionaries

```typescript
const dict = fs.readFileSync('my-dict.zstd');

// These 1000 operations will only create ONE temp file total
for (let i = 0; i < 1000; i++) {
  await compressBuffer(data[i], 3, { dictionary: dict });
}
// Temp file is automatically cleaned up when no longer referenced
```

### Example 6: Smart Decompression (Auto-detect)

The decompression functions automatically detect if data is zstd-compressed and pass through uncompressed data unchanged.

```typescript
import { decompressBuffer } from "simple-zstd";

async function smartDecompress() {
  const plainText = Buffer.from("not compressed");
  const result = await decompressBuffer(plainText);

  // Non-compressed data passes through unchanged
  console.log(result.toString()); // "not compressed"
}

smartDecompress().catch(console.error);
```

## Advanced Options

### Custom zstd Options

Pass any command-line option to the zstd process via `zstdOptions`:

```typescript
import { compress } from "simple-zstd";

// Use ultra compression (level 22)
const stream = await compress(22, {
  zstdOptions: ["--ultra"],
});

// Multiple options
const stream2 = await compress(19, {
  zstdOptions: ["--ultra", "--long"],
});
```

### Spawn Options

Control the child process spawn behavior:

```typescript
import { compress } from "simple-zstd";

const stream = await compress(3, {
  spawnOptions: {
    cwd: "/custom/working/directory",
    env: { ...process.env, CUSTOM_VAR: "value" },
  },
});
```

### Stream Options

Customize the Duplex stream behavior:

```typescript
import { compress } from "simple-zstd";

const stream = await compress(3, {
  streamOptions: {
    highWaterMark: 64 * 1024, // 64KB buffer
  },
});
```

### Stream Events

All compression and decompression streams emit the following events:

```typescript
import { compress } from "simple-zstd";

const stream = await compress(3);

// Standard Duplex stream events
stream.on("data", (chunk: Buffer) => {
  console.log("Received chunk:", chunk.length, "bytes");
});

stream.on("end", () => {
  console.log("Stream finished");
});

stream.on("error", (err: Error) => {
  console.error("Stream error:", err);
});

// zstd-specific events
stream.on("stderr", (message: string) => {
  // zstd process stderr output
  console.warn("zstd stderr:", message);
});

stream.on("exit", (code: number, signal: NodeJS.Signals | null) => {
  // zstd process exit event
  console.log("zstd process exited with code:", code);
});
```

**Event Reference:**

- `data` - Emitted when compressed/decompressed data is available
- `end` - Emitted when the stream has finished processing
- `error` - Emitted on stream errors or if zstd exits with non-zero code
- `stderr` - Emitted when the zstd process writes to stderr (warnings, debug info)
- `exit` - Emitted when the underlying zstd process exits

## Debugging

Enable debug output using the `DEBUG` environment variable:

```bash
# Debug simple-zstd operations
DEBUG=SimpleZSTD node app.js

# Debug process queue
DEBUG=SimpleZSTDQueue node app.js

# Debug both
DEBUG=SimpleZSTD,SimpleZSTDQueue node app.js
```

## Migrating to v2

Version 2.0 is a complete rewrite with TypeScript support and a modernized API. Here's what you need to know:

### Breaking Changes

#### 1. Node.js Version Requirement

**v1:** No explicit requirement
**v2:** Requires Node.js >= 18.0.0

```bash
# Check your Node version
node --version  # Should be v18.0.0 or higher
```

#### 2. Function Names Changed

| v1 Function             | v2 Function                                  |
| ----------------------- | -------------------------------------------- |
| `ZSTDCompress(level)`   | `compress(level, opts?)`                     |
| `ZSTDDecompress()`      | `decompress(opts?)`                          |
| `ZSTDDecompressMaybe()` | `decompress(opts?)` _(built-in auto-detect)_ |

**v1 Code:**

```javascript
const { ZSTDCompress, ZSTDDecompress } = require("simple-zstd");

const compressStream = ZSTDCompress(3);
const decompressStream = ZSTDDecompress();
```

**v2 Code:**

```javascript
const { compress, decompress } = require("simple-zstd");

const compressStream = await compress(3);
const decompressStream = await decompress();
```

#### 3. All Functions Now Return Promises

**v1:** Functions returned streams synchronously
**v2:** Functions return `Promise<Duplex>` and must be awaited

**v1 Code:**

```javascript
fs.createReadStream("file.txt")
  .pipe(ZSTDCompress(3))
  .pipe(ZSTDDecompress())
  .pipe(fs.createWriteStream("output.txt"));
```

**v2 Code:**

```javascript
const c = await compress(3);
const d = await decompress();

await pipeline(
  fs.createReadStream("file.txt"),
  c,
  d,
  fs.createWriteStream("output.txt")
);
```

#### 4. "Maybe" Functionality Now Built-in

**v1:** Had separate `ZSTDDecompressMaybe()` function
**v2:** All decompression functions auto-detect and pass through non-compressed data

**v1 Code:**

```javascript
const { ZSTDDecompressMaybe } = require("simple-zstd");

stream.pipe(ZSTDDecompressMaybe()).pipe(output);
```

**v2 Code:**

```javascript
const { decompress } = require("simple-zstd");

const d = await decompress(); // Automatically detects compressed data
pipeline(stream, d, output);
```

#### 5. Options Structure Changed

**v1:** Limited options as separate parameters
**v2:** Unified options object with TypeScript types

**v1 Code:**

```javascript
// v1 had limited customization
ZSTDCompress(3, streamOptions);
```

**v2 Code:**

```javascript
await compress(3, {
  dictionary: Buffer.from("..."),
  zstdOptions: ["--ultra"],
  spawnOptions: { cwd: "/tmp" },
  streamOptions: { highWaterMark: 64 * 1024 },
});
```

### New Features in v2

#### TypeScript Support

```typescript
import { compress, decompress, SimpleZSTD } from "simple-zstd";
import type { ZSTDOpts, PoolOpts } from "simple-zstd";
```

#### Buffer Interface

New convenience methods for working with buffers directly:

```typescript
import { compressBuffer, decompressBuffer } from "simple-zstd";

const compressed = await compressBuffer(Buffer.from("data"), 3);
const decompressed = await decompressBuffer(compressed);
```

#### Process Pooling with SimpleZSTD Class

Pre-spawn processes for better performance with async factory method:

```typescript
import { SimpleZSTD } from "simple-zstd";

const zstd = await SimpleZSTD.create({
  compressQueueSize: 2,
  decompressQueueSize: 2,
  compressQueue: {
    compLevel: 3,
    dictionary: Buffer.from("..."), // Optional
  },
});

// Use pooled processes
const stream = await zstd.compress();

// Or override compression level for specific operations
const stream2 = await zstd.compress(19);

// Clean up when done
zstd.destroy();
```

#### Dictionary Support

Full support for compression dictionaries:

```typescript
const dictionary = fs.readFileSync("dict.zstd");

await compress(3, { dictionary });
await compressBuffer(data, 3, { dictionary });
```

### Migration Examples

#### Simple Stream Compression

**v1:**

```javascript
const { ZSTDCompress, ZSTDDecompress } = require("simple-zstd");

fs.createReadStream("input.txt")
  .pipe(ZSTDCompress(3))
  .pipe(fs.createWriteStream("output.zst"));
```

**v2:**

```javascript
const { compress } = require("simple-zstd");
const { pipeline } = require("node:stream/promises");

const c = await compress(3);
await pipeline(
  fs.createReadStream("input.txt"),
  c,
  fs.createWriteStream("output.zst")
);
```

#### Error Handling

**v1:**

```javascript
ZSTDCompress(3).on("error", (err) => console.error(err));
```

**v2:**

```javascript
try {
  const c = await compress(3);
  c.on("error", (err) => console.error(err));
} catch (err) {
  console.error("Failed to create stream:", err);
}
```

#### With Custom Options

**v1:**

```javascript
// Limited options in v1
const stream = ZSTDCompress(3, { highWaterMark: 64 * 1024 });
```

**v2:**

```javascript
const stream = await compress(3, {
  streamOptions: { highWaterMark: 64 * 1024 },
  zstdOptions: ["--ultra"],
});
```

### Upgrade Checklist

- [ ] Update Node.js to >= 18.0.0
- [ ] Replace `ZSTDCompress` with `compress`
- [ ] Replace `ZSTDDecompress` with `decompress`
- [ ] Replace `ZSTDDecompressMaybe` with `decompress` (same function)
- [ ] Add `await` to all compression/decompression calls
- [ ] Update imports to use new function names
- [ ] Consider using buffer methods (`compressBuffer`/`decompressBuffer`) for simpler use cases
- [ ] Consider using `SimpleZSTD` class for high-throughput scenarios
- [ ] Update error handling for async/await pattern
- [ ] Update tests to handle promises

## Performance Benchmarks

This package has been benchmarked against other zstd packages.
At this time is appears to be the fastest package for processing large files.

[Benchmark Tests](https://github.com/Stieneee/node-compression-test)

## Performance Considerations

This package spawns a child process for each compression or decompression operation. While this provides excellent performance for large files, child process creation overhead can become a bottleneck when processing many small files rapidly.

**Solution:** Use the `SimpleZSTD` class with process pooling for high-throughput scenarios:

```typescript
const zstd = await SimpleZSTD.create({
  compressQueueSize: 4, // Pre-spawn 4 compression processes
  decompressQueueSize: 4, // Pre-spawn 4 decompression processes
});

// Reuse pooled processes for multiple operations
for (const file of files) {
  const stream = await zstd.compress();
  // ... process file ...
}

zstd.destroy(); // Clean up when done
```

Process pooling significantly reduces latency by reusing existing child processes instead of spawning new ones for each operation.

## Contributing

Pull requests are welcome.

## License

MIT License

Copyright (c) 2025 Tyler Stiene

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
