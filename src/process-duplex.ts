import { Duplex } from 'node:stream';
import { spawn, ChildProcess, SpawnOptions } from 'node:child_process';
import type { DuplexOptions } from 'node:stream';

type SpawnProcessFn = (command: string, args: string[], options?: SpawnOptions) => ChildProcess;
type NonZeroExitPolicy =
  | boolean
  | ((code: number | null, signal: NodeJS.Signals | null) => boolean);

interface ProcessDuplexOptions {
  command: string;
  args: string[];
  spawnOptions?: SpawnOptions;
  streamOptions?: DuplexOptions;
  nonZeroExitPolicy?: NonZeroExitPolicy;
  spawnProcess?: SpawnProcessFn;
}

export default class ProcessDuplex extends Duplex {
  #process: ChildProcess;
  #nonZeroExitPolicy?: NonZeroExitPolicy;
  #stdoutDataHandler?: (chunk: Buffer) => void;
  #stdoutErrorHandler?: (err: Error) => void;
  #stderrDataHandler?: (chunk: Buffer) => void;
  #processCloseHandler?: (code: number | null, signal: NodeJS.Signals | null) => void;
  #processErrorHandler?: (err: Error) => void;

  constructor(options: ProcessDuplexOptions) {
    super(options.streamOptions);

    const { command, args, spawnOptions } = options;
    const spawnProcess = options.spawnProcess ?? (spawn as unknown as SpawnProcessFn);
    this.#nonZeroExitPolicy = options.nonZeroExitPolicy;

    // Spawn the child process
    this.#process = spawnProcess(command, args, spawnOptions || {});
    this.#setupProcessHandlers();
  }

  #setupProcessHandlers() {
    this.#attachStdinHandler();
    this.#attachStdoutHandler();
    this.#attachStderrHandler();
    this.#attachLifecycleHandlers();
  }

  #attachStdinHandler() {
    if (this.#process.stdin) {
      this.#process.stdin.on('error', (err: Error) => {
        if (!this.destroyed) {
          this.destroy(err);
        }
      });
    }
  }

  #attachStdoutHandler() {
    if (this.#process.stdout) {
      this.#stdoutDataHandler = (chunk: Buffer) => {
        const canPushMore = this.push(chunk);
        if (!canPushMore) {
          this.#process.stdout?.pause();
        }
      };
      this.#process.stdout.on('data', this.#stdoutDataHandler);

      this.#stdoutErrorHandler = (err: Error) => {
        this.destroy(err);
      };
      this.#process.stdout.on('error', this.#stdoutErrorHandler);
    }
  }

  #attachStderrHandler() {
    if (this.#process.stderr) {
      this.#stderrDataHandler = (chunk: Buffer) => {
        // Emit stderr as a warning or error event
        this.emit('stderr', chunk.toString());
      };
      this.#process.stderr.on('data', this.#stderrDataHandler);
    }
  }

  #attachLifecycleHandlers() {
    this.#processCloseHandler = (code: number | null, signal: NodeJS.Signals | null) => {
      this.emit('exit', code, signal);

      // Only end readable side after successful process completion.
      if (code === 0 && signal === null && !this.readableEnded) {
        this.push(null);
      } else if (this.#shouldErrorOnNonZeroExit(code, signal) && !this.destroyed) {
        setImmediate(() => {
          if (!this.destroyed) {
            this.destroy(new Error(`zstd exited non zero. code: ${code} signal: ${signal}`));
          }
        });
      }
    };
    this.#process.on('close', this.#processCloseHandler);

    // Handle process errors
    this.#processErrorHandler = (err: Error) => {
      this.destroy(err);
    };
    this.#process.on('error', this.#processErrorHandler);
  }

  #shouldErrorOnNonZeroExit(code: number | null, signal: NodeJS.Signals | null): boolean {
    const policy = this.#nonZeroExitPolicy;
    return typeof policy === 'function' ? policy(code, signal) : policy === true;
  }

  _read(_size: number) {
    // Resume stdout if it was paused
    if (this.#process.stdout && this.#process.stdout.isPaused()) {
      this.#process.stdout.resume();
    }
  }

  _write(chunk: Buffer, encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    // Write to the process stdin
    if (this.#process.stdin) {
      if (!this.#process.stdin.write(chunk, encoding)) {
        // If the write buffer is full, wait for drain
        this.#process.stdin.once('drain', callback);
      } else {
        callback();
      }
    } else {
      callback(new Error('Process stdin is not available'));
    }
  }

  _final(callback: (error?: Error | null) => void) {
    // Close stdin when the writable side is finished
    if (this.#process.stdin) {
      this.#process.stdin.end(callback);
    } else {
      callback();
    }
  }

  _destroy(error: Error | null, callback: (error: Error | null) => void) {
    this.#removeEventListeners();

    if (this.#hasExited()) {
      callback(error);
      return;
    }

    if (this.#process && !this.#process.killed) {
      this.#terminateProcess(error, callback);
    } else {
      callback(error);
    }
  }

  #removeEventListeners() {
    if (this.#process.stdout) {
      if (this.#stdoutDataHandler)
        this.#process.stdout.removeListener('data', this.#stdoutDataHandler);
      if (this.#stdoutErrorHandler)
        this.#process.stdout.removeListener('error', this.#stdoutErrorHandler);
    }

    if (this.#process.stderr && this.#stderrDataHandler) {
      this.#process.stderr.removeListener('data', this.#stderrDataHandler);
    }

    if (this.#processCloseHandler) {
      this.#process.removeListener('close', this.#processCloseHandler);
    }

    if (this.#processErrorHandler) {
      this.#process.removeListener('error', this.#processErrorHandler);
    }
  }

  #hasExited(): boolean {
    return this.#process.exitCode !== null || this.#process.signalCode !== null;
  }

  #terminateProcess(error: Error | null, callback: (error: Error | null) => void) {
    let callbackCalled = false;

    const finishDestroy = () => {
      if (callbackCalled) return;
      callbackCalled = true;
      this.#process.removeListener('close', onClose);
      callback(error);
    };

    if (this.#process.stdin && !this.#process.stdin.destroyed) {
      this.#process.stdin.end();
    }

    const onClose = () => {
      clearTimeout(forceKillTimeout);
      finishDestroy();
    };

    this.#process.once('close', onClose);
    this.#process.kill();

    const forceKillTimeout = setTimeout(() => {
      if (!this.#hasExited()) {
        this.#process.kill('SIGKILL');
      }

      setTimeout(finishDestroy, 100);
    }, 1000);
  }
}
