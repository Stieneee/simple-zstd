import { Duplex } from 'node:stream';
import { spawn, ChildProcess, SpawnOptions } from 'node:child_process';
import type { DuplexOptions } from 'node:stream';

export default class ProcessDuplex extends Duplex {
  #process: ChildProcess;
  #stdoutDataHandler?: (chunk: Buffer) => void;
  #stdoutEndHandler?: () => void;
  #stdoutErrorHandler?: (err: Error) => void;
  #stdoutCloseHandler?: () => void;
  #stderrDataHandler?: (chunk: Buffer) => void;
  #processExitHandler?: (code: number | null, signal: NodeJS.Signals | null) => void;
  #processErrorHandler?: (err: Error) => void;

  constructor(
    command: string,
    args: string[],
    spawnOptions?: SpawnOptions,
    streamOptions?: DuplexOptions,
  ) {
    super(streamOptions);

    // Spawn the child process
    this.#process = spawn(command, args, spawnOptions || {});

    // Forward stdout to the readable side of this duplex
    if (this.#process.stdout) {
      this.#stdoutDataHandler = (chunk: Buffer) => {
        const canPushMore = this.push(chunk);
        if (!canPushMore) {
          this.#process.stdout?.pause();
        }
      };
      this.#process.stdout.on('data', this.#stdoutDataHandler);

      this.#stdoutEndHandler = () => {
        // Signal end of readable side
        this.push(null);
      };
      this.#process.stdout.on('end', this.#stdoutEndHandler);

      this.#stdoutErrorHandler = (err: Error) => {
        this.destroy(err);
      };
      this.#process.stdout.on('error', this.#stdoutErrorHandler);

      this.#stdoutCloseHandler = () => {
        // Ensure we signal end if not already done
        this.push(null);
      };
      this.#process.stdout.on('close', this.#stdoutCloseHandler);
    }

    // Forward stderr errors
    if (this.#process.stderr) {
      this.#stderrDataHandler = (chunk: Buffer) => {
        // Emit stderr as a warning or error event
        this.emit('stderr', chunk.toString());
      };
      this.#process.stderr.on('data', this.#stderrDataHandler);
    }

    // Handle process exit
    this.#processExitHandler = (code: number | null, signal: NodeJS.Signals | null) => {
      this.emit('exit', code, signal);
    };
    this.#process.on('exit', this.#processExitHandler);

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
      if (this.#stdoutDataHandler) this.#process.stdout.removeListener('data', this.#stdoutDataHandler);
      if (this.#stdoutEndHandler) this.#process.stdout.removeListener('end', this.#stdoutEndHandler);
      if (this.#stdoutErrorHandler) this.#process.stdout.removeListener('error', this.#stdoutErrorHandler);
      if (this.#stdoutCloseHandler) this.#process.stdout.removeListener('close', this.#stdoutCloseHandler);
    }

    if (this.#process.stderr && this.#stderrDataHandler) {
      this.#process.stderr.removeListener('data', this.#stderrDataHandler);
    }

    if (this.#processExitHandler) {
      this.#process.removeListener('exit', this.#processExitHandler);
    }

    if (this.#processErrorHandler) {
      this.#process.removeListener('error', this.#processErrorHandler);
    }

    // Kill the child process and wait for it to exit
    if (this.#process && !this.#process.killed) {
      // Close stdin first so the process receives EOF and can exit cleanly
      if (this.#process.stdin && !this.#process.stdin.destroyed) {
        this.#process.stdin.end();
      }

      // Wait for the process to fully exit before calling callback
      const onClose = () => {
        clearTimeout(forceKillTimeout);
        callback(error);
      };

      // Set up close listener
      this.#process.once('close', onClose);

      // Kill the process (should exit quickly now that stdin is closed)
      this.#process.kill();

      // Force kill if process doesn't exit within 1 second
      const forceKillTimeout = setTimeout(() => {
        if (!this.#process.killed) {
          this.#process.kill('SIGKILL');
        }
        // Remove the close listener and call callback
        this.#process.removeListener('close', onClose);
        callback(error);
      }, 1000);
    } else {
      // Process already killed or doesn't exist
      callback(error);
    }
  }
}
