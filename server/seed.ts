import type { State, Task, Project, Member, Milestone } from '../shared/types';
import { workspaceToday } from '../shared/rules';
export const demoId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Fictional development fixtures only. Production bootstrap creates zero work records. */
export function demoSeed(now = new Date()): State {
  const stamp = now.toISOString();
  const workspaceId = demoId(1);
  const base = (id: number) => ({
    id: demoId(id),
    workspaceId,
    createdAt: stamp,
    updatedAt: stamp,
    version: 1,
  });
  const today = workspaceToday('America/Bogota', now);
  const offset = (days: number) => {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };
  const members: Member[] = [
    {
      ...base(10),
      userId: demoId(11),
      displayName: 'Alex Morgan',
      email: 'alex@example.test',
      role: 'admin',
      active: true,
    },
    {
      ...base(20),
      userId: demoId(21),
      displayName: 'Sam Rivera',
      email: 'sam@example.test',
      role: 'member',
      active: true,
    },
    {
      ...base(30),
      userId: demoId(31),
      displayName: 'Jordan Lee',
      email: 'jordan@example.test',
      role: 'member',
      active: true,
    },
  ];
  const names = ['Corpus', 'Rounds Pipeline', 'Portal', 'Autonomy', 'Models', 'Field Ops'];
  const descriptions = [
    'Prepare and evaluate the pilot corpus.',
    'Standardize review handoffs.',
    'Publish the project directory.',
    'Validate autonomous workflows.',
    'Compare model quality across evaluation rounds.',
    'Capture field observations.',
  ];
  const projects: Project[] = names.map((name, i) => ({
    ...base(100 + i),
    name,
    description: descriptions[i],
    ownerId: members[i % 3].id,
    status: i === 3 ? 'planned' : 'active',
    startDate: offset(-12),
    targetDate: offset(18 + i * 7),
    archivedAt: null,
  }));
  const milestones: Milestone[] = [
    {
      ...base(200),
      projectId: projects[0].id,
      name: 'Pilot readiness',
      description: 'A small, reviewed batch ready for evaluation.',
      targetDate: offset(4),
      sortOrder: 0,
    },
    {
      ...base(201),
      projectId: projects[0].id,
      name: 'Evaluation',
      description: 'Review pilot results and document the quality baseline.',
      targetDate: offset(11),
      sortOrder: 1,
    },
    {
      ...base(202),
      projectId: projects[0].id,
      name: 'Team rollout',
      description: 'A repeatable workflow for the next round.',
      targetDate: offset(18),
      sortOrder: 2,
    },
  ];
  const makeTask = (
    id: number,
    title: string,
    projectIndex = 0,
    overrides: Partial<Task> = {},
  ): Task => ({
    ...base(id),
    projectId: projects[projectIndex].id,
    parentId: null,
    milestoneId: projectIndex === 0 ? milestones[0].id : null,
    title,
    description: '',
    status: 'todo',
    assigneeId: members[0].id,
    collaboratorIds: [],
    startDate: null,
    dueDate: offset(3),
    blockedById: null,
    deletedAt: null,
    deletionBatchId: null,
    ...overrides,
  });
  const tasks = [
    makeTask(300, 'Define the review rubric', 0, {
      status: 'done',
      assigneeId: members[1].id,
      dueDate: offset(-3),
      description: 'Define the pilot review criteria.',
    }),
    makeTask(301, 'Prepare the pilot batch', 0, {
      status: 'in_progress',
      dueDate: today,
      collaboratorIds: [members[1].id, members[2].id],
      description:
        'Select representative samples, check coverage, and share the batch with reviewers.',
    }),
    makeTask(302, 'Confirm reviewer availability', 0, { assigneeId: null, dueDate: offset(1) }),
    makeTask(303, 'Review the pilot results', 0, {
      milestoneId: milestones[1].id,
      assigneeId: members[2].id,
      blockedById: demoId(301),
      dueDate: offset(7),
    }),
    makeTask(304, 'Document the quality baseline', 0, {
      milestoneId: milestones[1].id,
      dueDate: offset(9),
    }),
    makeTask(305, 'Publish the review checklist', 0, {
      milestoneId: milestones[2].id,
      dueDate: null,
    }),
    makeTask(306, 'Share the pilot notes', 0, {
      milestoneId: null,
      status: 'done',
      dueDate: offset(-1),
    }),
    makeTask(310, 'Select representative samples', 0, {
      parentId: demoId(301),
      milestoneId: null,
      status: 'done',
      assigneeId: members[1].id,
      dueDate: null,
    }),
    makeTask(311, 'Check coverage against the rubric', 0, {
      parentId: demoId(301),
      milestoneId: null,
      assigneeId: members[0].id,
      dueDate: today,
    }),
    makeTask(320, 'Review the round handoff', 1, { dueDate: offset(-2), status: 'in_progress' }),
    makeTask(321, 'Map the review checkpoints', 1, {
      assigneeId: members[1].id,
      dueDate: offset(2),
    }),
    makeTask(322, 'Write the reviewer guide', 1, { dueDate: offset(5) }),
    makeTask(330, 'Finish the project directory', 2, { dueDate: today, status: 'in_progress' }),
    makeTask(331, 'Check the navigation on mobile', 2, {
      assigneeId: members[2].id,
      dueDate: offset(5),
    }),
    makeTask(340, 'Define the first workflow', 3, { dueDate: null }),
    makeTask(350, 'Compare evaluation baselines', 4, { dueDate: offset(3), status: 'in_progress' }),
    makeTask(351, 'Capture regression cases', 4, { assigneeId: members[1].id, dueDate: offset(6) }),
    makeTask(360, 'Collect field observations', 5, {
      assigneeId: members[2].id,
      dueDate: offset(7),
    }),
  ];
  return {
    workspace: {
      id: workspaceId,
      name: 'Openrange',
      timeZone: 'America/Bogota',
      version: 1,
      createdAt: stamp,
      updatedAt: stamp,
    },
    members,
    projects,
    tasks,
    milestones,
    comments: [
      {
        ...base(400),
        taskId: demoId(301),
        authorId: members[1].id,
        body: 'Rubric ready. Examples added for edge cases.',
        mentionIds: [],
        editedAt: null,
        deletedAt: null,
      },
    ],
    activities: [
      {
        id: demoId(500),
        workspaceId,
        entityType: 'task',
        entityId: demoId(301),
        actorId: members[0].id,
        eventType: 'status_changed',
        changedFields: { status: { from: 'todo', to: 'in_progress' } },
        occurredAt: stamp,
      },
    ],
    notifications: [
      {
        id: demoId(600),
        workspaceId,
        recipientId: members[0].id,
        activityId: demoId(500),
        taskId: demoId(301),
        kind: 'change',
        readAt: null,
      },
    ],
    invites: [],
    receipts: [],
  };
}
