import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { demoId, demoSeed } from '../server/seed';
import { loadState, saveState } from '../server/store/postgres';
import { DemoStore } from '../server/store/demo';
import type { State } from '../shared/types';
import type { Store } from '../server/store/types';
import { Domain } from '../server/domain';
import { admin } from './helpers';
import { randomUUID } from 'node:crypto';

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    'create schema auth; create table auth.users(id uuid primary key); create role anon nologin; create role authenticated nologin;',
  );
  for (const migration of (await readdir('supabase/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort())
    await db.exec(await readFile(`supabase/migrations/${migration}`, 'utf8'));
  const seed = demoSeed(new Date('2026-10-10T15:00:00Z'));
  await db.exec('begin');
  for (const member of seed.members)
    await db.query('insert into auth.users(id) values($1)', [member.userId]);
  await db.query(
    'insert into openrange.workspaces(id,name,time_zone,created_at,updated_at) values($1,$2,$3,$4,$4)',
    [seed.workspace.id, seed.workspace.name, seed.workspace.timeZone, seed.workspace.createdAt],
  );
  const empty: State = {
    ...seed,
    members: [],
    projects: [],
    tasks: [],
    milestones: [],
    comments: [],
    activities: [],
    notifications: [],
    invites: [],
    receipts: [],
  };
  await saveState(db, empty, seed);
  await db.exec('commit');
});
afterAll(async () => {
  await db?.close();
});
describe('normalized Postgres schema and adapter', () => {
  it('round-trips server records, collaborators, and date-only values', async () => {
    const state = await loadState(db, demoId(1));
    expect(state.tasks).toHaveLength(18);
    expect(state.tasks.find((t) => t.id === demoId(301))).toMatchObject({
      dueDate: '2026-10-10',
      collaboratorIds: [demoId(20), demoId(30)],
    });
    expect(state.members.find((m) => m.id === demoId(10))?.displayName).toBe('Alex Morgan');
  });
  it('enforces parent completion even through a direct SQL write', async () => {
    await db.exec('begin');
    await db.query("update openrange.tasks set status='done',version=version+1 where id=$1", [
      demoId(301),
    ]);
    await expect(db.exec('commit')).rejects.toThrow(/parent state/);
    await db.exec('rollback');
  });
  it('rejects direct blocker cycles, task moves, and last-admin removal', async () => {
    await db.exec('begin');
    await db.query('update openrange.tasks set blocked_by_id=$1,version=version+1 where id=$2', [
      demoId(303),
      demoId(301),
    ]);
    await expect(db.exec('commit')).rejects.toThrow(/cycle/);
    await db.exec('rollback');
    await expect(
      db.query('update openrange.tasks set project_id=$1 where id=$2', [demoId(101), demoId(301)]),
    ).rejects.toThrow(/fixed/);
    await db.exec('begin');
    await db.query("update openrange.members set role='member',version=version+1 where id=$1", [
      demoId(10),
    ]);
    await expect(db.exec('commit')).rejects.toThrow(/active admin/);
    await db.exec('rollback');
  });
  it('makes audit history append-only and keeps browser tables under RLS', async () => {
    await expect(
      db.query('delete from openrange.activities where id=$1', [demoId(500)]),
    ).rejects.toThrow(/append-only/);
    const result = await db.query<{ count: number }>(
      "select count(*)::int as count from pg_tables where schemaname='openrange' and rowsecurity",
    );
    expect(result.rows[0].count).toBe(12);
  });
  it('rejects silent version reuse and closed-project content updates in SQL', async () => {
    await expect(
      db.query("update openrange.tasks set title='Unversioned' where id=$1", [demoId(301)]),
    ).rejects.toThrow(/one version/);
    await db.query(
      'update openrange.projects set archived_at=now(),version=version+1 where id=$1',
      [demoId(100)],
    );
    await expect(
      db.query("update openrange.tasks set title='Archived edit',version=version+1 where id=$1", [
        demoId(301),
      ]),
    ).rejects.toThrow(/closed or archived/);
    await db.exec('begin');
    await db.query("select set_config('openrange.operation','project.restore',true)");
    await db.query('update openrange.projects set archived_at=null,version=version+1 where id=$1', [
      demoId(100),
    ]);
    await db.exec('commit');
  });
  it('denies browser-role direct access and permanent task deletion by the runtime role', async () => {
    try {
      await db.exec('set role authenticated');
      await expect(db.query('select * from openrange.tasks')).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec('reset role');
    }
    try {
      await db.exec('set role openrange_app');
      await expect(
        db.query('delete from openrange.tasks where id=$1', [demoId(301)]),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec('reset role');
    }
  });
  it('runs domain mutations through the real runtime grants, including archived membership cleanup and trash restore', async () => {
    const sqlStore: Store = {
      read: () => loadState(db, demoId(1)),
      close: async () => {},
      transaction: async (fn, context) => {
        await db.exec('begin');
        try {
          await db.query("select set_config('openrange.operation',$1,true)", [
            context?.operation || '',
          ]);
          const before = await loadState(db, demoId(1)),
            next = structuredClone(before);
          const result = await fn(next);
          await saveState(db, before, next);
          await db.exec('commit');
          return result;
        } catch (error) {
          await db.exec('rollback');
          throw error;
        }
      },
    };
    const service = new Domain(sqlStore, 'test-only-signing-secret-for-database-tests');
    try {
      await db.exec('set role openrange_app');
      let state = await sqlStore.read();
      await service.mutate(
        admin,
        'project.archive',
        demoId(100),
        { expected_version: state.projects.find((p) => p.id === demoId(100))!.version },
        randomUUID(),
      );
      await service.mutate(
        admin,
        'member.patch',
        demoId(20),
        { expected_version: 1, active: false },
        randomUUID(),
      );
      state = await sqlStore.read();
      expect(state.tasks.find((t) => t.id === demoId(301))!.collaboratorIds).toEqual([demoId(30)]);
      expect(state.tasks.find((t) => t.id === demoId(300))!.assigneeId).toBe(demoId(20));
      await service.mutate(
        admin,
        'project.restore',
        demoId(100),
        { expected_version: state.projects.find((p) => p.id === demoId(100))!.version },
        randomUUID(),
      );
      state = await sqlStore.read();
      await service.mutate(
        admin,
        'task.trash',
        demoId(301),
        {
          expected_version: state.tasks.find((t) => t.id === demoId(301))!.version,
          scope: 'task_and_subtasks',
        },
        randomUUID(),
      );
      state = await sqlStore.read();
      await service.mutate(
        admin,
        'task.restore',
        demoId(301),
        { expected_version: state.tasks.find((t) => t.id === demoId(301))!.version },
        randomUUID(),
      );
      state = await sqlStore.read();
      expect(state.tasks.find((t) => t.id === demoId(301))!.deletedAt).toBeNull();
      expect(state.tasks.find((t) => t.id === demoId(303))!.blockedById).toBeNull();
      await expect(
        service.mutate(
          admin,
          'project.patch',
          demoId(100),
          {
            expected_version: state.projects.find((p) => p.id === demoId(100))!.version,
            ownerId: demoId(20),
          },
          randomUUID(),
        ),
      ).rejects.toMatchObject({ code: 'INACTIVE_MEMBER' });
      await service.mutate(
        admin,
        'task.patch',
        demoId(300),
        {
          expected_version: state.tasks.find((t) => t.id === demoId(300))!.version,
          status: 'todo',
          assigneeId: demoId(30),
        },
        randomUUID(),
      );
      state = await sqlStore.read();
      expect(state.tasks.find((t) => t.id === demoId(300))!.assigneeId).toBe(demoId(30));
    } finally {
      await db.exec('reset role');
    }
  });
});
it('persists demo writes on the server across adapter restarts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orpms-'));
  const path = join(directory, 'workspace.json');
  try {
    const first = await DemoStore.open(path, demoSeed());
    await first.transaction((s) => {
      s.tasks[0].title = 'A persisted change';
    });
    await first.close();
    const second = await DemoStore.open(path, demoSeed());
    expect((await second.read()).tasks[0].title).toBe('A persisted change');
    await second.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
