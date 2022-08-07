# simple-zstd

[![Build Status](https://travis-ci.org/Stieneee/simple-zstd.svg?branch=master)](https://travis-ci.org/Stieneee/simple-zstd)
[![Package Size Size](https://badgen.net/badge/packagephobia/install/simple-zstd)](https://packagephobia.now.sh/result?p=simple-zstd)
[![License](https://badgen.net/badge/license/MIT/blue)](https://choosealicense.com/licenses/mit/)

Node.js interface to system installed zstandard (zstd).

## "Simple"-ZSTD

The package name is inspired by another simple-git which is a wrapper around the git binary installed on the system.
In summary this package, like simple-git, attempts to provide a lightwieght wrapper around the system installed ZSTD binary.
This provides a more stable package in comparison to a package that builds against a library at the cost of having to manage child process.

A few additional features have made there way into version 2 including a class that will attempt to pre-start child processes before they are need for the most latenacy concerned applications.

Regardless of whether you are performing a compression or decompression or using a stream or buffer interface this package will spawn an instance of zstd to handle the action.
When the action is completed the child process will be killed.
A dicitionary parameter on all functions supports both buffer and path definintons.
If you provide the dictionary as a buffer this package will create a tmp file using the tmp (tmp-promise) package.

All functions return a promise.
This promise will return the stream or a buffer depending on the function type called.

Finally the decompression methods provide a "maybe" functionality.
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
spawnOptions = {} // node:child_process spawnOptions object - adjust the spwan options of the ZSTD process
streamOptions = {} // node:stream streamOptions - adjust the stream options 
zstdOptions = [] // Array of Options to pass to the zstd process e.g. ['--ultra']
dictionary = Buffer || {path} // Supply an optional dictionary buffer or path to dictionary file

// Static Functions
function compress(compLevel, spawnOptions, streamOptions, zstdOptions, dictionary) // returns a promise that resolves to a stream
function compressBuffer(buffer, compLevel, spawnOptions, streamOptions, zstdOptions, dictionary) // returns a promise that resolves to a buffer
function decompress(spawnOptions, streamOptions, zstdOptions, dictionary) // returns a promise that resolves to a stream
function decompressBuffer(buffer, spawnOptions, streamOptions, zstdOptions, dictionary) // returns a promise that resolves to a buffer
```

The SimpleZSTD class allows an the settings to be preset for a pool of child process.
The function names are the same on the class however the options can not be changed from the class constructor.

### Example - Stream Interface

This simple example reads a file, compressed, decopressed and writes the file as a copy.
Running this example will spawn two instances of zstd as child processes.

```javascript
const fs = require('fs');
const { pipeline } = require('node:stream');
const {compress, decompress} = require('simple-zstd');

async function copyFile() {
  const c = await compress(3);
  const d = await decompress();

  await pipeline(
    fs.createReadStream('example.txt'),
    c,
    d,
    fs.createWriteStream('example_copy.txt'),
    () => {
      console.log('The file has been compressed and decompressed to example_copy.txt')
    }
  );
}

copyFile();

```

### Example - Buffer Interface

This example demonstrates the use of the buffer interface

```javascript
const {compressBuffer, decompressBufer} = require('simple-zstd');

async function printString() {
  const buffer = Buffer.from('this is a test');

  const compressed = await compressBuffer(buffer, 3);
  const decompressed = await decompressBuffer(compressed);

  console.log(decompressed.toString()); // this is a test
}

printString();
```

### Example - Class Interface

This example demonstrates the use of the class interface.
Once a class instance is created it can be used to with either the stream or buffer interface.
Options can not be changed once the class is instantiated.
This due to the fact that the class will start to spawn child processes with settings passed to the constructor.
Calling ```destroy()``` will kill all child processes.

```javascript
const fs = require('fs');
const { pipeline } = require('node:stream');
const { SimpleZSTD } = require('simple-zstd');

poolOptions = {
    compressQueue: { 
      targetSize: 1 // this determines how many instances of zstd are spawned into the qeueue. leaving it empty will result child processes to bring spawned as needed.
      compLevel, 
      spawnOptions, 
      streamOptions, 
      zstdOptions
    }, 
    decompressQueue: { 
      targetSize: 1 // there is a queue for both compression and decompression
      spawnOptions, 
      streamOptions, 
      zstdOptions
    }, 
}

async function copyFile() {
  const i = new SimpleZSTD(poolOptions, dictionary); // poolOptions set options for the compressions and decompressiong porcess pools. dictionary is optional and set for both pools.

  const c = await i.compress(3); // this will pull a instance from the queue
  const d = await i.decompress();

  pipeline(
    fs.createReadStream('example.txt'),
    c,
    d,
    brake(200000),
    fs.createWriteStream('example_copy.txt'),
    () => {
      console.log('The file has been compressed and decompressed to example_copy.txt')
    }
  );
}

copyFile();
```

## zstdOptions

This interface allows you to pass any command line option to the zstd process.
  
```javascript
const c2 = await compress(22, {}, {}, ['--ultra']);
```

## Debug

The package supports the debug package.
Setting the DEBUD Environment variable will cause the debug messages to be printed to the console.
This will presents debug information for both zstd spawns and the child process queue.

```bash
DEBUG=SimpleZSTD,SimpleZSTDQueue node example.js

```

## Contributing

Pull requests are welcome.

## License

MIT License

Copyright (c) 2022 Tyler Stiene

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
