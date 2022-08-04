# simple-zstd

[![Build Status](https://travis-ci.org/Stieneee/simple-zstd.svg?branch=master)](https://travis-ci.org/Stieneee/simple-zstd)
[![Package Size Size](https://badgen.net/badge/packagephobia/install/simple-zstd)](https://packagephobia.now.sh/result?p=simple-zstd)
[![License](https://badgen.net/badge/license/MIT/blue)](https://choosealicense.com/licenses/mit/)

Node.js interface to system installed zstandard (zstd).

## "Simple"-ZSTD

The package name is inspired by another package simple-git.
In summary the package like simple-git attempts to provide a lightwieght wrapper around the system installed ZSTD.
This provides a more stable package in comparison to a package that builds against a library at the cost of having to manage child process.

A few additional features have made there into version 2 including a class that will attempt to pre-start child processes before they are need for the most latenacy concerned applications

Regardless of whether you are performing a compression or decompression or using a stream or buffer interface this package will spawn an instance of zstd to handle the action.
When the action is completed the child process will be killed.
A dicitionary parameter supports both buffer and path definintons.
If you provide the dictionary as a buffer this package will create a tmp file using the tmp (tmp-promise) package.

Finally both decompressiong methods provide a decomporess-maybe functionality.
If a buffer or stream is passed that is not a zstd compressed byte stream the byte stream is not altered.

## Dependencies

ZSTD must be installed on the system.
It will work in both Linux and Windows environments assuming the zstd(.exe) can be found on the path.

Example:

`sudo apt install zstd`

## Installation

`npm i simple-zstd`

## Usage

The static functions provide the most basic interface for usage

```javascript
const {compress, decompress, compressBuffer, decompressBuffer} = require('../index');

compLevel = 3; // ZSTD Compression Level
spawnOptions = {} // node:stream spawnOptions object - adjust the spwan options of the ZSTD process
streamOptions = {} // 
zstdOptions = [] // Array of Options to pass to the zstd process e.g. ['--ultra']
dictionary = Buffer || {path} // Supply an optional dictionary buffer or path to dictionary file

// Static Functions
function compress(compLevel, spawnOptions, streamOptions, zstdOptions, dictionary)
function compressBuffer(buffer, compLevel, spawnOptions, streamOptions, zstdOptions, dictionary)
function decompress(spawnOptions, streamOptions, zstdOptions, dictionary)
function decompressBuffer(buffer, spawnOptions, streamOptions, zstdOptions, dictionary)
```

The SimpleZSTD class allows an the settings to be preset for a pool of child process.
The function names are the same on the class however the options are now set an instacne of the class is created.


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
