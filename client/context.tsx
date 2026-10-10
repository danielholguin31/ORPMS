import { createContext, useContext } from 'react';
import type { Session, Snapshot } from '../shared/types';
export interface AppContextValue {
  data: Snapshot;
  session: Session;
  online: boolean;
  busy: boolean;
  saveState: 'saved' | 'saving' | 'failed' | '';
  refresh: () => Promise<void>;
  change: <T = any>(path: string, body: unknown, method?: string) => Promise<T>;
  notify: (message: string) => void;
  switchAccount: (id: string) => Promise<void>;
}
export const AppContext = createContext<AppContextValue | null>(null);
export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error('Missing workspace context');
  return value;
}
