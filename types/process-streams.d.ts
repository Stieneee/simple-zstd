declare module 'process-streams' {
  import { Duplex, DuplexOptions } from 'stream';
  import { SpawnOptions } from 'child_process';

  export default class ProcessStream {
    spawn(
      command: string,
      args: string[],
      spawnOptions?: SpawnOptions,
      streamOptions?: DuplexOptions
    ): Duplex;
  }
}
