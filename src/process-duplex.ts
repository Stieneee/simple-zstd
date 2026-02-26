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
  #stdoutDataHandler?: (chunk: Buffer) => void;
  #stdoutErrorHandler?: (err: Error) => void;
  #stderrDataHandler?: (chunk: Buffer) => void;
  #processCloseHandler?: (code: number | null, signal: NodeJS.Signals | null) => void;
  #processErrorHandler?: (err: Error) => void;

  constructor(options: ProcessDuplexOptions) {
    super(options.streamOptions);

    const { command, args, spawnOptions, nonZeroExitPolicy } = options;
    const spawnProcess = options.spawnProcess ?? (spawn as unknown as SpawnProcessFn);

    // Spawn the child process
    this.#process = spawnProcess(command, args, spawnOptions || {});

    // Forward stdout to the readable side of this duplex
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

    // Forward stderr errors
    if (this.#process.stderr) {
      this.#stderrDataHandler = (chunk: Buffer) => {
        // Emit stderr as a warning or error event
        this.emit('stderr', chunk.toString());
      };
      this.#process.stderr.on('data', this.#stderrDataHandler);
    }

    // Handle process close (after stdio is fully flushed/closed)
    this.#processCloseHandler = (code: number | null, signal: NodeJS.Signals | null) => {
      this.emit('exit', code, signal);

      const policy = nonZeroExitPolicy;
      const shouldErrorOnNonZeroExit =
        typeof policy === 'function' ? policy(code, signal) : policy === true;

      // Only end readable side after successful process completion.
      // For non-zero exit, callers listening to "exit" can convert to stream errors.
      if (code === 0 && signal === null && !this.readableEnded) {
        this.push(null);
      } else if (shouldErrorOnNonZeroExit && !this.destroyed) {
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
    // Remove all event listeners to prevent memory leaks
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

    // If the process has already exited, cleanup is complete.
    if (this.#process.exitCode !== null || this.#process.signalCode !== null) {
      callback(error);
      return;
    }

    // Kill the child process and wait for it to exit
    if (this.#process && !this.#process.killed) {
      let callbackCalled = false;

      const finishDestroy = () => {
        if (callbackCalled) return;
        callbackCalled = true;
        this.#process.removeListener('close', onClose);
        callback(error);
      };

      // Close stdin first so the process receives EOF and can exit cleanly
      if (this.#process.stdin && !this.#process.stdin.destroyed) {
        this.#process.stdin.end();
      }

      // Wait for the process to fully exit before calling callback
      const onClose = () => {
        clearTimeout(forceKillTimeout);
        finishDestroy();
      };

      // Set up close listener
      this.#process.once('close', onClose);

      // Kill the process (should exit quickly now that stdin is closed)
      this.#process.kill();

      // Force kill if process doesn't exit within 1 second
      const forceKillTimeout = setTimeout(() => {
        // "killed" only indicates a signal was sent, not that the process exited.
        if (this.#process.exitCode === null && this.#process.signalCode === null) {
          this.#process.kill('SIGKILL');
        }

        // If close never arrives, still complete destroy after a short grace period.
        setTimeout(finishDestroy, 100);
      }, 1000);
    } else {
      // Process already killed or doesn't exist
      callback(error);
    }
  }
}
