import { readFileSync } from 'node:fs';
import pg from 'pg';
import type { State } from '../../shared/types';
import type { Store } from './types';
import { AppError } from '../errors';

pg.types.setTypeParser(1082, (v) => v); // date-only values must never become JS Dates.
export interface SqlClient {
  query(sql: string, params?: any[]): Promise<{ rows: any[] }>;
}
const snake = (name: string) => name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const camel = (name: string) => name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
function record(row: Record<string, any>) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => {
      const normalized = value instanceof Date ? value.toISOString() : value;
      return [
        camel(key),
        key.endsWith('_date') && typeof normalized === 'string'
          ? normalized.slice(0, 10)
          : normalized,
      ];
    }),
  );
}
const definitions = {
  projects: 'projects',
  milestones: 'milestones',
  tasks: 'tasks',
  comments: 'comments',
  activities: 'activities',
  notifications: 'notifications',
  invites: 'invites',
  receipts: 'mutation_receipts',
} as const;

export async function loadState(client: SqlClient, workspaceId: string): Promise<State> {
  const workspace = (
    await client.query('select * from openrange.workspaces where id=$1', [workspaceId])
  ).rows[0];
  if (!workspace)
    throw new AppError(
      503,
      'WORKSPACE_NOT_BOOTSTRAPPED',
      'The workspace has not been initialized. See the integration handoff.',
    );
  const members = (
    await client.query(
      'select m.*,p.display_name,p.email from openrange.members m join openrange.profiles p on p.user_id=m.user_id where m.workspace_id=$1 order by m.id',
      [workspaceId],
    )
  ).rows.map(record);
  const state: any = { workspace: record(workspace), members };
  for (const [key, table] of Object.entries(definitions))
    state[key] = (
      await client.query(`select * from openrange.${table} where workspace_id=$1 order by id`, [
        workspaceId,
      ])
    ).rows.map(record);
  const links = (
    await client.query('select * from openrange.task_collaborators where workspace_id=$1', [
      workspaceId,
    ])
  ).rows;
  for (const task of state.tasks)
    task.collaboratorIds = links
      .filter((l) => l.task_id === task.id)
      .map((l) => l.member_id)
      .sort();
  return state;
}
async function upsert(client: SqlClient, table: string, row: Record<string, any>) {
  const keys = Object.keys(row);
  const columns = keys.map(snake);
  const updates = columns
    .filter((c) => c !== 'id' && c !== 'created_at')
    .map((c) => `${c}=excluded.${c}`)
    .join(',');
  const conflict = ['activities', 'mutation_receipts'].includes(table)
    ? 'do nothing'
    : `do update set ${updates}`;
  await client.query(
    `insert into openrange.${table} (${columns.join(',')}) values (${keys.map((_, i) => `$${i + 1}`).join(',')}) on conflict (id) ${conflict}`,
    keys.map((k) => row[k]),
  );
}
const changed = (before: any, after: any) =>
  !before || JSON.stringify(before) !== JSON.stringify(after);
export async function saveState(client: SqlClient, previous: State, next: State) {
  if (changed(previous.workspace, next.workspace))
    await client.query(
      'update openrange.workspaces set name=$2,time_zone=$3,version=$4,updated_at=$5 where id=$1',
      [
        next.workspace.id,
        next.workspace.name,
        next.workspace.timeZone,
        next.workspace.version,
        next.workspace.updatedAt,
      ],
    );
  for (const member of next.members) {
    if (
      !changed(
        previous.members.find((m) => m.id === member.id),
        member,
      )
    )
      continue;
    const { displayName, email, ...membership } = member;
    await client.query(
      'insert into openrange.profiles (user_id,display_name,email) values ($1,$2,$3) on conflict (user_id) do update set display_name=excluded.display_name,email=excluded.email',
      [member.userId, displayName, email],
    );
    await upsert(client, 'members', membership);
  }
  for (const [key, table] of Object.entries(definitions)) {
    const rows = next[key as keyof typeof definitions] as any[];
    const oldRows = previous[key as keyof typeof definitions] as any[];
    for (const row of rows) {
      const before = oldRows.find((r) => r.id === row.id);
      if (!changed(before, row)) continue;
      const { collaboratorIds, ...columns } = row;
      await upsert(client, table, columns);
      if (key === 'tasks') {
        const oldLinks: string[] = before?.collaboratorIds || [];
        for (const memberId of oldLinks.filter((id) => !collaboratorIds.includes(id)))
          await client.query(
            'delete from openrange.task_collaborators where workspace_id=$1 and task_id=$2 and member_id=$3',
            [next.workspace.id, row.id, memberId],
          );
        for (const memberId of collaboratorIds.filter((id: string) => !oldLinks.includes(id)))
          await client.query(
            'insert into openrange.task_collaborators(workspace_id,task_id,member_id) values($1,$2,$3)',
            [next.workspace.id, row.id, memberId],
          );
      }
    }
  }
  // Only milestones and expired receipts are physically removed.
  for (const key of ['milestones', 'receipts'] as const) {
    for (const row of previous[key].filter((r) => !next[key].some((n) => n.id === r.id)))
      await client.query(
        `delete from openrange.${definitions[key]} where id=$1 and workspace_id=$2`,
        [row.id, next.workspace.id],
      );
  }
}

export class PostgresStore implements Store {
  private pool: pg.Pool;
  constructor(
    connectionString: string,
    private workspaceId: string,
    caFile?: string,
  ) {
    this.pool = new pg.Pool({
      connectionString,
      max: 5,
      ssl: { rejectUnauthorized: true, ...(caFile ? { ca: readFileSync(caFile, 'utf8') } : {}) },
      connectionTimeoutMillis: 10000,
    });
    this.pool.on('error', () =>
      process.stderr.write('Database connection error; inspect provider health.\n'),
    );
  }
  async read() {
    const client = await this.pool.connect();
    try {
      await client.query('begin isolation level repeatable read read only');
      const state = await loadState(client, this.workspaceId);
      await client.query('commit');
      return state;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
  async transaction<T>(
    fn: (state: State) => T | Promise<T>,
    context?: { operation: string; actorUserId: string },
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query("set local statement_timeout = '15s'");
      await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
        this.workspaceId,
      ]);
      await client.query(
        "select set_config('openrange.operation',$1,true),set_config('openrange.actor_user_id',$2,true)",
        [context?.operation || '', context?.actorUserId || ''],
      );
      const previous = await loadState(client, this.workspaceId);
      const next = structuredClone(previous);
      const result = await fn(next);
      await saveState(client, previous, next);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      if (error instanceof AppError) throw error;
      if ((error as { code?: string }).code === '23514')
        throw new AppError(
          409,
          'DATABASE_INVARIANT',
          'The saved state changed. Refresh and retry this action.',
        );
      throw error;
    } finally {
      client.release();
    }
  }
  async close() {
    await this.pool.end();
  }
}
