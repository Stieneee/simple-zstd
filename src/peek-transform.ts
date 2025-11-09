import { Duplex, pipeline } from 'node:stream';
import type { TransformOptions } from 'node:stream';

type SwapCallback = (err: Error | null, stream: Duplex | null) => void;
type PeekCallback = (data: Buffer, swap: SwapCallback) => void;

interface PeekOptions extends TransformOptions {
  maxBuffer?: number;
}

export default class PeekPassThrough extends Duplex {
  #maxBuffer: number;
  #buffer: Buffer[];
  #bufferedLength: number;
  #peeked: boolean;
  #peekCallback: PeekCallback;
  #swappedStream: Duplex | null;
  #ended: boolean;

  constructor(options: PeekOptions, peekCallback: PeekCallback) {
    super(options);
    this.#maxBuffer = options.maxBuffer || 65536;
    this.#buffer = [];
    this.#bufferedLength = 0;
    this.#peeked = false;
    this.#peekCallback = peekCallback;
    this.#swappedStream = null;
    this.#ended = false;
  }

  _write(chunk: Buffer, encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    // If we already peeked and have a swapped stream, write to it
    if (this.#peeked && this.#swappedStream) {
      this.#swappedStream.write(chunk, encoding, callback);
      return;
    }

    // If we already peeked but no swap, just pass through
    if (this.#peeked) {
      this.push(chunk);
      callback();
      return;
    }

    // Buffer chunks until we have enough to peek
    this.#buffer.push(chunk);
    this.#bufferedLength += chunk.length;

    if (this.#bufferedLength >= this.#maxBuffer) {
      this.#performPeek(callback);
    } else {
      callback();
    }
  }

  _final(callback: (error?: Error | null) => void) {
    // If we haven't peeked yet and stream is ending, peek now
    if (!this.#peeked) {
      this.#performPeek(callback);
    } else if (this.#swappedStream) {
      // End the swapped stream
      this.#swappedStream.end(callback);
    } else {
      // No swap - signal EOF for passthrough case
      if (!this.#ended) {
        this.#ended = true;
        this.push(null);
      }
      callback();
    }
  }

  _read(size: number) {
    // If we have a swapped stream, resume it if paused
    if (this.#swappedStream) {
      if (this.#swappedStream.isPaused && this.#swappedStream.isPaused()) {
        this.#swappedStream.resume();
      }
    }
  }

  #performPeek(callback: (error?: Error | null) => void) {
    this.#peeked = true;

    const peekData = Buffer.concat(this.#buffer);

    // Call the peek callback to determine which stream to use
    this.#peekCallback(peekData, (err: Error | null, swappedStream: Duplex | null) => {
      if (err) {
        callback(err);
        return;
      }

      if (swappedStream) {
        // We have a swapped stream
        this.#swappedStream = swappedStream;

        // Pipe swapped stream's output to our output
        swappedStream.on('data', (chunk: Buffer) => {
          if (!this.push(chunk)) {
            swappedStream.pause();
          }
        });

        swappedStream.on('end', () => {
          if (!this.#ended) {
            this.#ended = true;
            this.push(null);
          }
        });

        swappedStream.on('error', (streamErr: Error) => {
          this.destroy(streamErr);
        });

        // Resume reading when downstream is ready
        this.on('drain', () => {
          if (swappedStream.isPaused && swappedStream.isPaused()) {
            swappedStream.resume();
          }
        });

        // Write all buffered data to the swapped stream
        for (const bufferedChunk of this.#buffer) {
          swappedStream.write(bufferedChunk);
        }

        // Ensure the swapped stream is in flowing mode
        if (swappedStream.isPaused && swappedStream.isPaused()) {
          swappedStream.resume();
        }
      } else {
        // No swap - just push buffered data through
        for (const bufferedChunk of this.#buffer) {
          this.push(bufferedChunk);
        }
      }

      // Clear the buffer
      this.#buffer = [];
      this.#bufferedLength = 0;

      callback();
    });
  }

  _destroy(error: Error | null, callback: (error: Error | null) => void) {
    if (this.#swappedStream && !this.#swappedStream.destroyed) {
      this.#swappedStream.destroy();
    }
    callback(error);
  }
}
