import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { State } from '../../shared/types';
import type { Store } from './types';

/** Single-process development adapter. Mutations commit to an atomic server-side file. */
export class DemoStore implements Store {
  private queue: Promise<unknown> = Promise.resolve();
  private constructor(
    private path: string,
    private state: State,
  ) {}
  static async open(path: string, initial: State) {
    let state = initial;
    try {
      state = JSON.parse(await readFile(path, 'utf8')) as State;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const store = new DemoStore(path, state);
    await store.persist(state);
    return store;
  }
  async read() {
    await this.queue;
    return structuredClone(this.state);
  }
  transaction<T>(fn: (state: State) => T | Promise<T>): Promise<T> {
    const operation = this.queue.then(async () => {
      const draft = structuredClone(this.state);
      const result = await fn(draft);
      await this.persist(draft);
      this.state = draft;
      return result;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  private async persist(state: State) {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
    await rename(temporary, this.path);
  }
  async close() {
    await this.queue;
  }
}
