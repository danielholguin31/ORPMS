import type { State } from '../../shared/types';
export interface Store {
  read(): Promise<State>;
  transaction<T>(
    fn: (state: State) => T | Promise<T>,
    context?: { operation: string; actorUserId: string },
  ): Promise<T>;
  close(): Promise<void>;
}
