import type { SupabaseClient } from '@supabase/supabase-js';
import type { ApiErrorBody, ApiResult, PublicConfig } from '../shared/types';

export class ApiFault extends Error {
  constructor(
    public status: number,
    public detail: ApiErrorBody,
  ) {
    super(detail.message);
  }
}
let provider: SupabaseClient | null = null;
let csrf = '';
const attempts = new Map<string, string>();
export async function configureAuth(config: PublicConfig) {
  // SEBASTIAN-02: Configure redirect allowlists/SMTP and provision managed users.
  if (config.mode === 'supabase') {
    const { createClient } = await import('@supabase/supabase-js');
    provider = createClient(config.supabaseUrl!, config.supabasePublishableKey!);
  }
  return provider;
}
export function authProvider() {
  return provider;
}
export function setCsrf(token = '') {
  csrf = token;
}
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const session = provider ? (await provider.auth.getSession()).data.session : null;
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      credentials: 'same-origin',
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new ApiFault(0, {
      code: 'NETWORK',
      message: 'Connection lost. Your draft is preserved. Reconnect and try again.',
    });
  }
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiFault(
      response.status,
      body?.error || {
        code: 'UNAVAILABLE',
        message: 'The server is unavailable. Your draft is preserved.',
      },
    );
  return body as T;
}
export const get = <T>(path: string) => request<ApiResult<T>>(path).then((r) => r.data);
export async function mutate<T>(path: string, body: unknown, method = 'POST'): Promise<T> {
  const signature = `${method}:${path}:${JSON.stringify(body)}`;
  const key = attempts.get(signature) || crypto.randomUUID();
  attempts.set(signature, key);
  try {
    const result = await request<ApiResult<T>>(path, {
      method,
      body: JSON.stringify(body),
      headers: { 'Idempotency-Key': key },
    });
    attempts.delete(signature);
    return result.data;
  } catch (error) {
    // Keep the same key for uncertain network/server results; no duplicate write on retry.
    if (error instanceof ApiFault && error.status >= 400 && error.status < 500)
      attempts.delete(signature);
    throw error;
  }
}
export async function exportWorkspace() {
  const data = await request<any>('/admin/export');
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `openrange-export-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
