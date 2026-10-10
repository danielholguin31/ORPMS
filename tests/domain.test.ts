import { beforeEach, describe, expect, it } from 'vitest';
import { Domain, inviteToken } from '../server/domain';
import { demoId, demoSeed } from '../server/seed';
import { randomUUID } from 'node:crypto';
import { childProgress, dueGroup, progress, workspaceToday } from '../shared/rules';
import { MemoryStore, admin, member } from './helpers';
const secret = 'test-secret-with-at-least-thirty-two-characters';
let store: MemoryStore, service: Domain;
const call = (
  op: Parameters<Domain['mutate']>[1],
  id: string | null,
  body: unknown,
  actor = admin,
  key = randomUUID(),
) => service.mutate(actor, op, id, body, key);
const task = (id: number) => store.state.tasks.find((t) => t.id === demoId(id))!;

beforeEach(() => {
  store = new MemoryStore();
  service = new Domain(store, secret, () => new Date('2026-10-10T15:00:00Z'));
});
describe('deterministic coordination rules', () => {
  it('does not count subtasks in project progress or silently complete a parent', async () => {
    const parent = task(301),
      doneParent = { ...task(300) },
      child = task(311);
    await call('task.patch', child.id, { expected_version: child.version, status: 'done' });
    expect(task(301).status).toBe('in_progress');
    expect(
      progress([doneParent, parent, ...store.state.tasks.filter((t) => t.parentId === parent.id)]),
    ).toEqual({ done: 1, total: 2, percent: 50 });
  });
  it('shows no active tasks for empty/all-canceled progress and excludes canceled children', () => {
    expect(progress([]).total).toBe(0);
    expect(progress([{ ...task(300), status: 'canceled' }]).total).toBe(0);
    expect(childProgress([{ ...task(310), status: 'canceled' }, task(311)])).toEqual({
      done: 0,
      total: 1,
    });
  });
  it('rejects parent completion with open children and preserves all records on failure', async () => {
    await expect(
      call('task.patch', demoId(301), { expected_version: 1, status: 'done' }),
    ).rejects.toMatchObject({ code: 'OPEN_SUBTASKS' });
    expect(task(301).version).toBe(1);
    expect(task(311).status).toBe('todo');
    expect(store.state.receipts).toHaveLength(0);
  });
  it('serializes a race between parent completion and child creation', async () => {
    await call('task.patch', demoId(311), { expected_version: 1, status: 'done' });
    const result = await Promise.allSettled([
      call('task.patch', demoId(301), { expected_version: 1, status: 'done' }),
      call('task.create', null, {
        projectId: demoId(100),
        parentId: demoId(301),
        title: 'Racing child',
      }),
    ]);
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      store.state.tasks.some(
        (t) =>
          t.parentId === demoId(301) && !t.deletedAt && ['todo', 'in_progress'].includes(t.status),
      ),
    ).toBe(false);
  });
  it('gives a new subtask only its project and effective milestone', async () => {
    const { data } = await call('task.create', null, {
      projectId: demoId(100),
      parentId: demoId(301),
      title: 'New subtask',
    });
    expect(data).toMatchObject({
      assigneeId: null,
      collaboratorIds: [],
      startDate: null,
      dueDate: null,
      milestoneId: null,
    });
    await expect(
      call('task.create', null, { projectId: demoId(100), parentId: data.id, title: 'Too deep' }),
    ).rejects.toMatchObject({ code: 'INVALID_PARENT' });
  });
  it('rejects invalid dates and never shifts another record', async () => {
    const old = structuredClone(task(311));
    await expect(
      call('task.patch', demoId(301), {
        expected_version: 1,
        startDate: '2026-10-12',
        dueDate: '2026-10-11',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_DATES' });
    await expect(
      call('task.patch', demoId(301), { expected_version: 1, dueDate: '2026-02-30' }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(
      call('task.patch', demoId(301), { expected_version: 1, dueDate: '0000-01-01' }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await call('task.patch', demoId(301), { expected_version: 1, dueDate: '2026-10-15' });
    expect(task(311)).toEqual(old);
  });
  it('uses the workspace date across midnight and DST', () => {
    const now = new Date('2026-11-01T03:30:00Z');
    const today = workspaceToday('America/New_York', now);
    expect(today).toBe('2026-10-31');
    expect(dueGroup({ ...task(311), dueDate: today }, today)).toBe('Today');
    expect(dueGroup({ ...task(311), dueDate: '2026-10-30' }, today)).toBe('Overdue');
  });
  it('rejects self, cross-project, parent/child and cyclic blockers', async () => {
    for (const blocker of [demoId(301), demoId(320), demoId(311)])
      await expect(
        call('task.patch', demoId(301), { expected_version: 1, blockedById: blocker }),
      ).rejects.toMatchObject({ code: 'INVALID_BLOCKER' });
    await expect(
      call('task.patch', demoId(301), { expected_version: 1, blockedById: demoId(303) }),
    ).rejects.toMatchObject({ code: 'BLOCKER_CYCLE' });
  });
  it('preserves stale drafts through a 409 and replays only matching idempotent requests', async () => {
    const key = randomUUID();
    const body = { expected_version: 1, title: 'First edit' };
    const first = await call('task.patch', demoId(301), body, admin, key);
    expect(await call('task.patch', demoId(301), body, admin, key)).toEqual(first);
    await expect(
      call('task.patch', demoId(301), { expected_version: 1, title: 'Losing edit' }),
    ).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
      details: { current: { title: 'First edit', version: 2 } },
    });
    await expect(
      call('task.patch', demoId(301), { expected_version: 2, title: 'Different' }, admin, key),
    ).rejects.toMatchObject({ code: 'KEY_REUSED' });
    expect(store.state.activities.filter((a) => a.eventType === 'task_updated')).toHaveLength(1);
  });
  it('appends a comment independently, deduplicates recipients, and suppresses the actor', async () => {
    const key = randomUUID();
    const body = { body: 'Review please', mentionIds: [demoId(10), demoId(20)] };
    const before = task(301).version;
    const first = await call('comment.create', demoId(301), body, member, key);
    await call('comment.create', demoId(301), body, member, key);
    expect(task(301).version).toBe(before);
    expect(store.state.comments.filter((c) => c.id === first.data.id)).toHaveLength(1);
    const event = store.state.activities.find(
      (a) => a.changedFields.commentId?.to === first.data.id,
    )!;
    const notifications = store.state.notifications.filter((n) => n.activityId === event.id);
    expect(notifications.map((n) => n.recipientId).sort()).toEqual([demoId(10), demoId(30)]);
    expect(notifications.find((n) => n.recipientId === demoId(10))?.kind).toBe('mention');
  });
  it('restricts comment ownership and retains deleted tombstones', async () => {
    await expect(
      call('comment.patch', demoId(400), { expected_version: 1, body: 'Not mine' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const { data } = await call('comment.delete', demoId(400), { expected_version: 1 }, member);
    expect(data.body).toBe('');
    expect(data.deletedAt).not.toBeNull();
  });
  it('restores only the parent deletion batch and never recreates incoming blockers', async () => {
    await call('task.trash', demoId(310), { expected_version: 1, scope: 'task_and_subtasks' });
    await call('task.trash', demoId(301), { expected_version: 1, scope: 'task_and_subtasks' });
    expect(task(303).blockedById).toBeNull();
    await call('task.restore', demoId(301), { expected_version: task(301).version });
    expect(task(301).deletedAt).toBeNull();
    expect(task(311).deletedAt).toBeNull();
    expect(task(310).deletedAt).not.toBeNull();
    expect(task(303).blockedById).toBeNull();
  });
  it('cannot restore an open child under a closed parent', async () => {
    await call('task.trash', demoId(311), { expected_version: 1, scope: 'task_and_subtasks' });
    await call('task.patch', demoId(301), { expected_version: 1, status: 'done' });
    await expect(
      call('task.restore', demoId(311), { expected_version: task(311).version }),
    ).rejects.toMatchObject({ code: 'PARENT_CLOSED' });
    expect(task(311).deletedAt).not.toBeNull();
  });
  it('requires an admin for archive and rejects content edits in archived or closed projects', async () => {
    await expect(
      call('project.archive', demoId(100), { expected_version: 1 }, member),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await call('project.archive', demoId(100), { expected_version: 1 });
    await expect(
      call('comment.create', demoId(301), { body: 'Archived comment' }),
    ).rejects.toMatchObject({ code: 'PROJECT_ARCHIVED' });
    await expect(
      call('project.patch', demoId(101), { expected_version: 1, status: 'done' }),
    ).rejects.toMatchObject({ code: 'OPEN_TASKS' });
  });
  it('removes milestone grouping without removing tasks', async () => {
    await call('milestone.delete', demoId(200), { expected_version: 1 });
    expect(task(301).milestoneId).toBeNull();
    expect(store.state.tasks).toHaveLength(18);
  });
});
describe('membership and invitation safety', () => {
  it('serializes assignment/deactivation and simultaneous admin demotions', async () => {
    const assignment = await Promise.allSettled([
      call('task.patch', demoId(301), { expected_version: 1, assigneeId: demoId(20) }),
      call('member.patch', demoId(20), { expected_version: 1, active: false }),
    ]);
    expect(assignment.some((r) => r.status === 'fulfilled')).toBe(true);
    expect(task(301).assigneeId).toBeNull();
    await call('member.patch', demoId(30), { expected_version: 1, role: 'admin' });
    const jordan = { ...admin, userId: demoId(31), email: 'jordan@example.test' };
    const demotions = await Promise.allSettled([
      call('member.patch', demoId(10), { expected_version: 1, role: 'member' }),
      call('member.patch', demoId(30), { expected_version: 2, role: 'member' }, jordan),
    ]);
    expect(demotions.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(store.state.members.filter((m) => m.active && m.role === 'admin')).toHaveLength(1);
  });
  it('prevents last-admin demotion/deactivation', async () => {
    for (const patch of [{ role: 'member' }, { active: false }])
      await expect(
        call('member.patch', demoId(10), { expected_version: 1, ...patch }),
      ).rejects.toMatchObject({ code: 'LAST_ADMIN' });
  });
  it('deactivates without reassignment and rejects a stale assignment', async () => {
    await call('member.patch', demoId(20), { expected_version: 1, active: false });
    expect(task(321).assigneeId).toBeNull();
    expect(task(300).assigneeId).toBe(demoId(20));
    expect(task(301).collaboratorIds).not.toContain(demoId(20));
    await expect(
      call('task.patch', demoId(301), {
        expected_version: task(301).version,
        assigneeId: demoId(20),
      }),
    ).rejects.toMatchObject({ code: 'INACTIVE_MEMBER' });
    await expect(
      call('task.create', null, { projectId: demoId(101), title: 'Denied' }, member),
    ).rejects.toMatchObject({ code: 'NOT_A_MEMBER' });
  });
  it('rechecks authorization before replaying a successful receipt', async () => {
    const key = randomUUID();
    const body = { projectId: demoId(101), title: 'Original' };
    await call('task.create', null, body, member, key);
    await call('member.patch', demoId(20), { expected_version: 1, active: false });
    await expect(call('task.create', null, body, member, key)).rejects.toMatchObject({
      code: 'NOT_A_MEMBER',
    });
  });
  it('binds one-use invites to verified email and stores no plaintext token or receipt secret', async () => {
    const { data } = await call('invite.create', null, {
      email: 'new@example.test',
      role: 'member',
    });
    expect(data.tokenHash).toBeUndefined();
    const token = inviteToken(data.id, secret);
    const actor = {
      ...admin,
      userId: randomUUID(),
      email: 'new@example.test',
      displayName: 'New person',
    };
    await expect(
      call('invite.accept', null, { token }, { ...actor, verified: false }),
    ).rejects.toMatchObject({ code: 'EMAIL_UNVERIFIED' });
    await expect(
      call('invite.accept', null, { token }, { ...actor, email: 'wrong@example.test' }),
    ).rejects.toMatchObject({ code: 'WRONG_EMAIL' });
    await call('invite.accept', null, { token }, actor);
    await expect(call('invite.accept', null, { token }, actor)).rejects.toMatchObject({
      code: 'INVALID_INVITE',
    });
    expect(JSON.stringify(store.state.receipts)).not.toContain(token);
    expect(JSON.stringify(store.state.invites)).not.toContain(token);
  });
  it('rejects revoked and expired invitations', async () => {
    const actor = { ...admin, userId: randomUUID(), email: 'new@example.test' };
    const { data } = await call('invite.create', null, { email: actor.email });
    await call('invite.revoke', data.id, { expected_version: 1 });
    await expect(
      call('invite.accept', null, { token: inviteToken(data.id, secret) }, actor),
    ).rejects.toMatchObject({ code: 'INVALID_INVITE' });
    const another = await call('invite.create', null, { email: actor.email });
    service = new Domain(store, secret, () => new Date('2026-10-18T15:00:00Z'));
    await expect(
      call('invite.accept', null, { token: inviteToken(another.data.id, secret) }, actor),
    ).rejects.toMatchObject({ code: 'INVALID_INVITE' });
  });
});
