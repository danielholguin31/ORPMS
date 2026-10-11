export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'canceled';
export type ProjectStatus = 'planned' | 'active' | 'done' | 'canceled';
export type Role = 'admin' | 'member';
export interface RecordBase {
  id: string;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}
export interface Workspace {
  id: string;
  name: string;
  timeZone: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface Member extends RecordBase {
  userId: string;
  email: string;
  displayName: string;
  role: Role;
  active: boolean;
}
export interface Project extends RecordBase {
  name: string;
  description: string;
  ownerId: string | null;
  status: ProjectStatus;
  startDate: string | null;
  targetDate: string | null;
  archivedAt: string | null;
}
export interface Milestone extends RecordBase {
  projectId: string;
  name: string;
  description: string;
  targetDate: string | null;
  sortOrder: number;
}
export interface Task extends RecordBase {
  projectId: string;
  parentId: string | null;
  milestoneId: string | null;
  title: string;
  description: string;
  status: TaskStatus;
  assigneeId: string | null;
  collaboratorIds: string[];
  startDate: string | null;
  dueDate: string | null;
  blockedById: string | null;
  deletedAt: string | null;
  deletionBatchId: string | null;
}
export interface Comment extends RecordBase {
  taskId: string;
  authorId: string;
  body: string;
  mentionIds: string[];
  editedAt: string | null;
  deletedAt: string | null;
}
export interface Activity {
  id: string;
  workspaceId: string;
  entityType: 'task' | 'project' | 'milestone' | 'member' | 'workspace' | 'invite' | 'comment';
  entityId: string;
  actorId: string;
  eventType: string;
  changedFields: Record<string, { from: unknown; to: unknown }>;
  occurredAt: string;
}
export interface Notification {
  id: string;
  workspaceId: string;
  recipientId: string;
  activityId: string;
  taskId: string | null;
  kind: 'assignment' | 'comment' | 'mention' | 'change' | 'needs_owner';
  readAt: string | null;
}
export interface Invite extends RecordBase {
  email: string;
  role: Role;
  tokenHash: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  invitedBy: string;
}
export type PublicInvite = Omit<Invite, 'tokenHash'>;
export interface MutationReceipt {
  id: string;
  workspaceId: string;
  actorUserId: string;
  idempotencyKey: string;
  requestHash: string;
  responseJson: unknown;
  statusCode: number;
  expiresAt: string;
}
export interface State {
  workspace: Workspace;
  members: Member[];
  projects: Project[];
  milestones: Milestone[];
  tasks: Task[];
  comments: Comment[];
  activities: Activity[];
  notifications: Notification[];
  invites: Invite[];
  receipts: MutationReceipt[];
}
export interface Actor {
  userId: string;
  email: string;
  verified: boolean;
  displayName: string;
}
export interface Snapshot extends Omit<State, 'invites' | 'receipts'> {
  invites: PublicInvite[];
}
export interface Session {
  member: Member;
  workspace: Workspace;
  mode: 'demo' | 'supabase';
  csrfToken?: string;
  demoAccounts?: { userId: string; displayName: string; role: Role }[];
}
export interface PublicConfig {
  mode: 'demo' | 'supabase';
  supabaseUrl?: string;
  supabasePublishableKey?: string;
}
export interface ApiErrorBody {
  code: string;
  message: string;
  fields?: Record<string, string>;
  current?: unknown;
}
export interface ApiResult<T> {
  data: T;
  version?: number;
}
export interface ApiPage<T> extends ApiResult<T[]> {
  next_cursor: string | null;
}
export interface Progress {
  done: number;
  total: number;
  percent: number;
}
export interface ProjectSummary extends Project {
  progress: Progress;
}
export interface MilestoneSummary extends Milestone {
  progress: Progress;
}
export interface ProjectDetail extends ProjectSummary {
  milestones: MilestoneSummary[];
}
export interface TaskDetail {
  task: Task;
  project: Project;
  parent: Task | null;
  children: Task[];
  comments: Comment[];
  activities: Activity[];
  milestones: Milestone[];
  blockerCandidates: Task[];
}
export interface SearchResult {
  id: string;
  kind: 'task' | 'project';
  title: string;
  context: string;
  path: string;
  status?: TaskStatus;
}
