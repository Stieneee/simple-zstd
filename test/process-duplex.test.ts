import { describe, test } from 'node:test';
import assert from 'node:assert';
import { once, EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { ChildProcess, SpawnOptions } from 'node:child_process';

import ProcessDuplex from '../src/process-duplex';

class TrackingPassThrough extends PassThrough {
  pauseCount = 0;
  resumeCount = 0;

  override pause() {
    this.pauseCount += 1;
    return super.pause();
  }

  override resume() {
    this.resumeCount += 1;
    return super.resume();
  }
}

type FakeChildProcess = EventEmitter & {
  stdin: PassThrough;
  stdout: TrackingPassThrough;
  stderr: PassThrough;
  killed: boolean;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  killSignals: Array<NodeJS.Signals | undefined>;
  kill: (signal?: NodeJS.Signals) => boolean;
};

function createFakeChildProcess(opts?: {
  closeOnKill?: boolean;
  closeOnSigkill?: boolean;
}): FakeChildProcess {
  const closeOnKill = opts?.closeOnKill ?? true;
  const closeOnSigkill = opts?.closeOnSigkill ?? true;

  const child = new EventEmitter() as FakeChildProcess;
  child.stdin = new PassThrough();
  child.stdout = new TrackingPassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.exitCode = null;
  child.signalCode = null;
  child.killSignals = [];

  child.kill = (signal?: NodeJS.Signals) => {
    child.killSignals.push(signal);
    child.killed = true;

    const shouldClose = signal === 'SIGKILL' ? closeOnSigkill : closeOnKill;
    if (shouldClose) {
      setTimeout(() => {
        child.signalCode = (signal ?? 'SIGTERM') as NodeJS.Signals;
        child.emit('close', child.exitCode, child.signalCode);
      }, 10);
    }

    return true;
  };

  return child;
}

describe('ProcessDuplex isolated behavior', () => {
  test('supports injected spawn function', async () => {
    const fake = createFakeChildProcess();
    let calledCommand = '';
    let calledArgs: string[] = [];
    let calledOptions: SpawnOptions | undefined;

    const spawnProcess = (command: string, args: string[], options?: SpawnOptions) => {
      calledCommand = command;
      calledArgs = args;
      calledOptions = options;
      return fake as unknown as ChildProcess;
    };

    const stream = new ProcessDuplex({
      command: 'mock-zstd',
      args: ['-dc'],
      spawnOptions: { cwd: '/tmp/simple-zstd-test' },
      spawnProcess,
    });

    assert.equal(calledCommand, 'mock-zstd');
    assert.deepEqual(calledArgs, ['-dc']);
    assert.equal(calledOptions?.cwd, '/tmp/simple-zstd-test');

    stream.destroy();
    await once(stream, 'close');
  });

  test('force-kills when initial kill does not close process', async () => {
    const fake = createFakeChildProcess({ closeOnKill: false, closeOnSigkill: true });
    const stream = new ProcessDuplex({
      command: 'mock-zstd',
      args: [],
      spawnProcess: () => {
        return fake as unknown as ChildProcess;
      },
    });

    const startedAt = Date.now();
    stream.destroy();
    await once(stream, 'close');
    const elapsedMs = Date.now() - startedAt;

    assert.ok(fake.killSignals.includes('SIGKILL'));
    assert.ok(elapsedMs >= 950, `Expected force-kill timeout path, elapsed=${elapsedMs}ms`);
  });

  test('destroy callback path fires once when process never closes', async () => {
    const fake = createFakeChildProcess({ closeOnKill: false, closeOnSigkill: false });
    const stream = new ProcessDuplex({
      command: 'mock-zstd',
      args: [],
      spawnProcess: () => {
        return fake as unknown as ChildProcess;
      },
    });

    let closeCount = 0;
    stream.on('close', () => {
      closeCount += 1;
    });

    stream.destroy();
    await once(stream, 'close');
    await new Promise((resolve) => setTimeout(resolve, 300));

    assert.equal(closeCount, 1);
    assert.ok(fake.killSignals.includes('SIGKILL'));
  });

  test('pauses on backpressure and resumes on _read', async () => {
    const fake = createFakeChildProcess();
    const stream = new ProcessDuplex({
      command: 'mock-zstd',
      args: [],
      spawnProcess: () => {
        return fake as unknown as ChildProcess;
      },
    });

    // Force backpressure path for deterministic testing.
    const originalPush = stream.push.bind(stream);
    (stream as unknown as { push: (chunk: Buffer | null) => boolean }).push = (
      chunk: Buffer | null
    ) => {
      if (chunk !== null) return false;
      return originalPush(chunk);
    };

    fake.stdout.emit('data', Buffer.from('abc'));
    assert.equal(fake.stdout.pauseCount, 1);

    const resumeCountBeforeRead = fake.stdout.resumeCount;
    stream._read(0);
    assert.ok(fake.stdout.resumeCount > resumeCountBeforeRead);

    stream.destroy();
    await once(stream, 'close');
  });

  test('emits error on non-zero exit when policy is enabled', async () => {
    const fake = createFakeChildProcess();
    const stream = new ProcessDuplex({
      command: 'mock-zstd',
      args: [],
      nonZeroExitPolicy: true,
      spawnProcess: () => fake as unknown as ChildProcess,
    });

    const errorPromise = once(stream, 'error') as Promise<[Error]>;
    fake.emit('close', 2, null);
    const [err] = await errorPromise;

    assert.match(err.message, /zstd exited non zero\. code: 2 signal: null/);
  });

  test('does not emit error on non-zero exit when policy is disabled', async () => {
    const fake = createFakeChildProcess();
    const stream = new ProcessDuplex({
      command: 'mock-zstd',
      args: [],
      nonZeroExitPolicy: false,
      spawnProcess: () => fake as unknown as ChildProcess,
    });

    let errored = false;
    stream.on('error', () => {
      errored = true;
    });

    fake.emit('close', 3, null);
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(errored, false);
    stream.destroy();
    await once(stream, 'close');
  });
});
