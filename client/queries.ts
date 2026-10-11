import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiFault, get, getAll } from './api';
import { useApp } from './context';

const savedReads = new Map<string, unknown>();
export const clearQueryCache = () => savedReads.clear();

export interface QueryState<T> {
  result: T | null;
  loading: boolean;
  error: string;
  retry: () => void;
}
/** Resource routes provide the visible records. The snapshot only invalidates
 * these reads after writes/polling and supplies shared names and relationships. */
export function useApiQuery<T>(path: string | null, collection = false): QueryState<T> {
  const { data, session, online } = useApp();
  const key = `${session.member.id}:${path}`;
  const [state, setState] = useState<{
    key: string;
    result: T | null;
    error: string;
    loading: boolean;
  }>({
    key,
    result: (savedReads.get(key) as T) ?? null,
    error: '',
    loading: !!path && online,
  });
  const [revision, setRevision] = useState(0);
  const current = useRef(key);
  current.current = key;
  const retry = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    if (!online) {
      setState((s) => {
        const result = s.key === key ? s.result : ((savedReads.get(key) as T) ?? null);
        return { key, result, error: result ? '' : 'Reconnect to load this view.', loading: false };
      });
      return;
    }
    setState((s) => ({
      key,
      result: s.key === key ? s.result : ((savedReads.get(key) as T) ?? null),
      error: '',
      loading: true,
    }));
    const read = collection ? getAll : get;
    void read<T>(path, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted && current.current === key) {
          savedReads.set(key, result);
          if (savedReads.size > 200) savedReads.delete(savedReads.keys().next().value!);
          setState({ key, result: result as T, error: '', loading: false });
        }
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted && current.current === key) {
          const denied = error instanceof ApiFault && [401, 403].includes(error.status);
          if (denied) savedReads.delete(key);
          setState((s) => ({
            ...s,
            result: denied ? null : s.result,
            error: error.message,
            loading: false,
          }));
        }
      });
    return () => controller.abort();
  }, [path, key, collection, data, online, revision]);
  if (!path) return { result: null, loading: false, error: '', retry };
  return {
    ...(state.key === key
      ? state
      : { result: (savedReads.get(key) as T) ?? null, loading: online, error: '' }),
    retry,
  };
}
export const useApiCollection = <T>(path: string | null) => useApiQuery<T[]>(path, true);
