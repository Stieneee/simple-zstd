# simple-zstd

[![Build Status](https://travis-ci.org/Stieneee/simple-zstd.svg?branch=master)](https://travis-ci.org/Stieneee/simple-zstd)
[![Package Size Size](https://badgen.net/badge/packagephobia/install/simple-zstd)](https://packagephobia.now.sh/result?p=simple-zstd)
[![License](https://badgen.net/badge/license/MIT/blue)](https://choosealicense.com/licenses/mit/)

Node.js interface to system installed zstandard (zstd).

## Why Another ZSTD Package

Other packages were either using out-of-date ZSTD versions or depended on native C bindings that required a compilation step during installation.
A package was needed that would cleanly work with [pkg](https://www.npmjs.com/package/pkg).

## Dependencies

ZSTD

Example:

`sudo apt install zstd`

## Installation

`npm i simple-zstd`

## Usage

simple-zstd exposes a stream interfaces for compression and decompression.
The underlying child process is destroyed with the stream.

stream = ZSTDCompress(lvl)
lvl - ZSTD compression level

stream = ZSTDDecompress()

stream = ZSTDDecompressMaybe()

### Example

```javascript
const fs = require('fs');
const {ZSTDCompress, ZSTDDecompress} = require('simple-zstd');

// ZSTDCompress(compressionLevel, streamOptions)
// ZSTDDecompress(streamOptions)

fs.createReadStream('example.txt')
  .pipe(ZSTDCompress(3))
  .pipe(ZSTDDecompress())
  .pipe(fs.createWriteStream('example_copy.txt'))
  .on('error', (err) => {
    //..
  })
  .on('finish', () => {
    console.log('Copy Complete!');
  })

  // -> Copy Complete
```

### Decompress Maybe

A maybe variant of decompress will pass-through a non-zst stream while decompressing a zst stream.

```javascript
const fs = require('fs');
const {ZSTDDecompressMaybe} = require('simple-zstd');

// ZSTDDecompressMaybe(spawnOptions, streamOptions, zstdOptions)

fs.createReadStream('example.txt')
  // .pipe(ZSTDCompress(3))
  .pipe(ZSTDDecompressMaybe())
  .pipe(fs.createWriteStream('example_copy.txt'))
  .on('error', (err) => {
    //..
  })
  .on('finish', () => {
    console.log('Copy Complete!');
  })

  // -> Copy Complete
```

## Contributing

Pull requests are welcome.

## License

MIT License

Copyright (c) 2020 Tyler Stiene

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
