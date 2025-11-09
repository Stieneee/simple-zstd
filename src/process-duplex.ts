import { Duplex } from 'node:stream';
import { spawn, ChildProcess, SpawnOptions } from 'node:child_process';
import type { DuplexOptions } from 'node:stream';

export default class ProcessDuplex extends Duplex {
  #process: ChildProcess;

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
      this.#process.stdout.on('data', (chunk: Buffer) => {
        const canPushMore = this.push(chunk);
        if (!canPushMore) {
          this.#process.stdout?.pause();
        }
      });

      this.#process.stdout.on('end', () => {
        // Signal end of readable side
        this.push(null);
      });

      this.#process.stdout.on('error', (err: Error) => {
        this.destroy(err);
      });

      this.#process.stdout.on('close', () => {
        // Ensure we signal end if not already done
        this.push(null);
      });
    }

    // Forward stderr errors
    if (this.#process.stderr) {
      this.#process.stderr.on('data', (chunk: Buffer) => {
        // Emit stderr as a warning or error event
        this.emit('stderr', chunk.toString());
      });
    }

    // Handle process exit
    this.#process.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      this.emit('exit', code, signal);
    });

    // Handle process errors
    this.#process.on('error', (err: Error) => {
      this.destroy(err);
    });
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
    // Kill the child process
    if (this.#process && !this.#process.killed) {
      this.#process.kill();
    }
    callback(error);
  }
}
