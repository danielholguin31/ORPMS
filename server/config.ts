import type { PublicConfig } from '../shared/types';

export interface Config {
  mode: 'demo' | 'supabase';
  port: number;
  origin: string;
  inviteSecret: string;
  dataPath: string;
  workspaceId?: string;
  databaseUrl?: string;
  databaseCaFile?: string;
  supabaseUrl?: string;
  supabasePublishableKey?: string;
  serveStatic: boolean;
}
export function configuration(env = process.env): Config {
  const mode = env.APP_MODE;
  if (mode !== 'demo' && mode !== 'supabase')
    throw new Error('Set APP_MODE=supabase for production, or use npm run dev for demo mode.');
  if (mode === 'demo' && env.NODE_ENV === 'production')
    throw new Error('Demo authentication and file storage are disabled in production.');
  const config: Config = {
    mode,
    port: Number(env.PORT || 3001),
    origin: (env.APP_ORIGIN || 'http://localhost:5173').replace(/\/$/, ''),
    inviteSecret:
      env.INVITE_SIGNING_SECRET ||
      (mode === 'demo' ? 'development-only-invite-secret-not-for-production' : ''),
    dataPath: env.DEV_DATA_PATH || '.data/dev-workspace.json',
    workspaceId: env.WORKSPACE_ID,
    databaseUrl: env.DATABASE_URL,
    databaseCaFile: env.DATABASE_CA_FILE,
    supabaseUrl: env.SUPABASE_URL,
    supabasePublishableKey: env.SUPABASE_PUBLISHABLE_KEY,
    serveStatic: env.NODE_ENV === 'production' || env.SERVE_STATIC === 'true',
  };
  if (mode === 'supabase') {
    for (const key of [
      'workspaceId',
      'databaseUrl',
      'supabaseUrl',
      'supabasePublishableKey',
      'inviteSecret',
    ] as const)
      if (!config[key]) throw new Error(`Missing ${key}. See docs/SEBASTIAN_HANDOFF.md.`);
    if (config.inviteSecret.length < 32)
      throw new Error('INVITE_SIGNING_SECRET must contain at least 32 random characters.');
    if (!/^https:\/\//.test(config.supabaseUrl!)) throw new Error('SUPABASE_URL must use HTTPS.');
    // SEBASTIAN-02: Only the publishable/anon key may reach /api/config.
    const publicKey = config.supabasePublishableKey!;
    let keyRole = '';
    try {
      keyRole =
        JSON.parse(Buffer.from(publicKey.split('.')[1] || '', 'base64url').toString()).role || '';
    } catch {}
    if (publicKey.startsWith('sb_secret_') || keyRole === 'service_role')
      throw new Error('SUPABASE_PUBLISHABLE_KEY must not be a service/admin key.');
    if (env.NODE_ENV === 'production' && !/^https:\/\//.test(config.origin))
      throw new Error('APP_ORIGIN must use HTTPS in production.');
  }
  return config;
}
export function publicConfig(config: Config): PublicConfig {
  return {
    mode: config.mode,
    ...(config.mode === 'supabase'
      ? { supabaseUrl: config.supabaseUrl, supabasePublishableKey: config.supabasePublishableKey }
      : {}),
  };
}
