/* eslint-env node, mocha */

const fs = require('fs');
const path = require('path');
const stream = require('stream');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');

const brake = require('brake');
const pipelineAsync = require('util').promisify(stream.pipeline);
const {
  SimpleZSTD, compress, decompress, compressBuffer, decompressBuffer,
} = require('../index');

chai.use(require('chai-fs'));

chai.use(chaiAsPromised); // use last

const { assert } = chai;

console.log(SimpleZSTD);

const sleepAsync = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ZSTDCompress(compressionLevel, streamOptions)
// ZSTDDecompress(streamOptions)

const src = path.join(__dirname, 'sample/earth.jpg');
const dst1 = '/tmp/example_copy1.txt';
const dst2 = '/tmp/example_copy2.txt';

const dstZstd1 = '/tmp/example_copy1.zst';
const dstZstd2 = '/tmp/example_copy2.zst';

const dictionary = path.join(__dirname, 'sample/dictionary');

describe('Test simple-zstd Static Functions', () => {
  beforeEach(() => {
    fs.rmSync(dst1, { force: true });
    fs.rmSync(dst2, { force: true });
    fs.rmSync(dstZstd1, { force: true });
    fs.rmSync(dstZstd2, { force: true });
  });

  it('should not alter the file', async () => {
    const c = await compress(3);
    const d = await decompress();

    return new Promise((resolve, reject) => {
      fs.createReadStream(src)
        .pipe(c)
        .pipe(d)
        .pipe(fs.createWriteStream(dst1))
        .on('error', reject)
        .on('finish', () => {
          try {
            assert.fileEqual(src, dst1);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
    });
  });

  it('should perform correctly with stream.pipeline', async () => {
    const c = await compress(3);
    const d = await decompress();

    await pipelineAsync(
      fs.createReadStream(src),
      c,
      d,
      fs.createWriteStream(dst1),
    );

    assert.fileEqual(src, dst1);
  });

  it('should handle back pressure', async () => {
    const c = await compress(3);
    const d = await decompress();

    await pipelineAsync(
      fs.createReadStream(src),
      c,
      d,
      brake(200000),
      fs.createWriteStream(dst1),
    );

    assert.fileEqual(src, dst1);
  }).timeout(30000);

  it('compression level should change compression', async () => {
    const c1 = await compress(1, {}, {}, []);
    const c2 = await compress(19, {}, {}, []);

    await pipelineAsync(
      fs.createReadStream(src),
      c1,
      fs.createWriteStream(dstZstd1),
    );

    await pipelineAsync(
      fs.createReadStream(src),
      c2,
      fs.createWriteStream(dstZstd2),
    );

    if (fs.statSync(dstZstd2).size >= fs.statSync(dstZstd1).size) {
      throw new Error('Compression level failed');
    }
  }).timeout(5000);

  it('should accept zstdOptions - ultra option', async () => {
    const c1 = await compress(1);
    const c2 = await compress(22, {}, {}, ['--ultra']);

    await pipelineAsync(
      fs.createReadStream(src),
      c1,
      fs.createWriteStream(dstZstd1),
    );

    await pipelineAsync(
      fs.createReadStream(src),
      c2,
      fs.createWriteStream(dstZstd2),
    );

    if (fs.statSync(dstZstd2).size >= fs.statSync(dstZstd1).size) {
      console.log(fs.statSync(dstZstd2).size, fs.statSync(dstZstd1).size);
      throw new Error('ultra test failed test failed');
    }
  }).timeout(30000);

  it('should throw an error if zstd is called incorrectly', async () => {
    // missing --ultra flag
    const c = await compress(22, { pipe: true }, {}, ['']);

    await chai.expect(pipelineAsync(
      fs.createReadStream(src),
      c,
      fs.createWriteStream(dstZstd2),
    )).to.be.rejected;
  }).timeout(30000);

  it('should accept a buffer', async () => {
    const buffer = Buffer.from('this is a test');

    const compressed = await compressBuffer(buffer, 3);
    const decompressed = await decompressBuffer(compressed);

    assert.deepEqual(buffer, decompressed);
  });

  it('should accept a bigger buffer', async () => {
    const buffer = fs.readFileSync(src);

    const compressed = await compressBuffer(buffer, 3);
    const decompressed = await decompressBuffer(compressed);

    assert.deepEqual(buffer, decompressed);
  });

  it('should accept a dictionary file as a buffer', async () => {
    const buffer = fs.readFileSync(src);
    const dictBuffer = fs.readFileSync(dictionary);

    const compressed = await compressBuffer(buffer, 3, {}, {}, [], dictBuffer);
    const decompressed = await decompressBuffer(compressed, {}, {}, [], dictBuffer);

    assert.deepEqual(buffer, decompressed);
  });

  it('should accept a dictionary file as a path', async () => {
    const buffer = fs.readFileSync(src);

    const compressed = await compressBuffer(buffer, 3, {}, {}, [], { path: dictionary });
    const decompressed = await decompressBuffer(compressed, {}, {}, [], { path: dictionary });

    assert.deepEqual(buffer, decompressed);
  });
});

describe('Test the Oven', () => {

});

describe.only('Test simple-zstd Class', () => {
  it('should behave as the static function', async () => {
    const i = new SimpleZSTD();

    const c = await i.compress(3);
    const d = await i.decompress();

    return new Promise((resolve, reject) => {
      fs.createReadStream(src)
        .pipe(c)
        .pipe(d)
        .pipe(fs.createWriteStream(dst1))
        .on('error', reject)
        .on('finish', () => {
          try {
            assert.fileEqual(src, dst1);
            i.destroy();
            resolve();
          } catch (err) {
            reject(err);
          }
        });
    });
  });

  it('should behave as the static function and pre create zstd child process', async () => {
    const i = new SimpleZSTD({
      compressQueueSize: { targetSize: 1 },
      decompressQueueSize: { targetSize: 1 },
    });

    await sleepAsync(1000);

    const c = await i.compress(3);
    const d = await i.decompress();

    return new Promise((resolve, reject) => {
      fs.createReadStream(src)
        .pipe(c)
        .pipe(d)
        .pipe(fs.createWriteStream(dst1))
        .on('error', reject)
        .on('finish', () => {
          try {
            assert.fileEqual(src, dst1);
            i.destroy();
            resolve();
          } catch (err) {
            reject(err);
          }
        });
    });
  });
});
