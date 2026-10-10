import type { Store } from '../server/store/types';
import type { Actor, State } from '../shared/types';
import { demoId, demoSeed } from '../server/seed';
export class MemoryStore implements Store {
  state: State;
  private queue = Promise.resolve();
  constructor(initial = demoSeed(new Date('2026-10-10T15:00:00Z'))) {
    this.state = structuredClone(initial);
  }
  async read() {
    await this.queue;
    return structuredClone(this.state);
  }
  transaction<T>(fn: (state: State) => T | Promise<T>): Promise<T> {
    const pending = this.queue.then(async () => {
      const draft = structuredClone(this.state);
      const result = await fn(draft);
      this.state = draft;
      return result;
    });
    this.queue = pending.then(
      () => {},
      () => {},
    );
    return pending;
  }
  async close() {}
}
export const admin: Actor = {
  userId: demoId(11),
  email: 'alex@example.test',
  verified: true,
  displayName: 'Alex Morgan',
};
export const member: Actor = {
  userId: demoId(21),
  email: 'sam@example.test',
  verified: true,
  displayName: 'Sam Rivera',
};
