/* eslint-disable no-await-in-loop */
/* eslint-disable no-console */

const { readFileSync } = require('fs');
const ProgressBar = require('progress');
const { default: PQueue } = require('p-queue');
const { SimpleZSTD, enableRAMDisk } = require('../index');

const sampleSize = 500;

async function test() {
  const buffer = readFileSync('./sample/training-files/user-0.json');
  const dictBuffer = readFileSync('./sample/dictionary');

  const bar = new ProgressBar(':rate :eta :bar', { total: sampleSize });

  // const queue = new PQueue({ concurrency: 32 });

  const z = new SimpleZSTD({
    compressQueue: { targetSize: 1, compLevel: 1 },
    decompressQueue: { targetSize: 1 },
  }, dictBuffer);

  const compressed = await z.compressBuffer(buffer);

  // await asyncSleep(100);

  // await enableRAMDisk();

  console.log('Start test');

  // for (let i = 0; i < sampleSize; i += 1) {
  //   queue.add(async () => {
  //     await z.decompressBuffer(compressed);
  //     bar.tick();
  //   });
  // }

  // queue.onEmpty().then(() => {
  //   console.log('Done');
  //   z.destroy();
  // });

  for (let i = 0; i < sampleSize; i += 1) {
    await z.decompressBuffer(compressed);
    bar.tick();
  }
  z.destroy();
}

test();
