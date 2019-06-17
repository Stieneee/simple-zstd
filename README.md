# simple-zstd

Node.js interface to system installed zstandard (zstd).

## Why Another ZSTD Package

Other packages where either using out-of-date ZSTD versions or depended native C bindings that required a compilation step during installation.
A package was needed that would cleanly work with [pkg](https://www.npmjs.com/package/pkg).

## Dependencies

ZSTD

Example:

`sudo apt install zstd`

## Installation

`npm i simple-zstd`

## Usage

simple-zstd exposes stream interfaces for compression and decompression.

```javascript
const fs = require('fs');
const {ZSTDCompress, ZSTDDecompress} = require('zstd');

// ZSTDCompress(compressionLevel, streamOptions)
// ZSTDDecompress(streamOptions)

fs.createReadStream('example.txt')
  .pipe(ZSTDCompress(3))
  .pipe(ZSTDDecompress())
  .pipe(fs.createWriteStream('example_copy.txt'))
  .on('error', (err) => {
    console.log(err);
  })
  .on('finish', () => {
    console.log('Copy Complete!');
  })
```

## Contributing

Pull requests are welcome.
