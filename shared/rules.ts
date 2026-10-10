import type { Task, TaskStatus } from './types';

export const TASK_LABELS: Record<TaskStatus, string> = {
  todo: 'Todo',
  in_progress: 'In progress',
  done: 'Done',
  canceled: 'Canceled',
};
export const isOpen = (status: string) => status === 'todo' || status === 'in_progress';
export const isClosed = (status: string) => status === 'done' || status === 'canceled';
export function progress(tasks: Task[]) {
  const eligible = tasks.filter((t) => !t.parentId && !t.deletedAt && t.status !== 'canceled');
  const done = eligible.filter((t) => t.status === 'done').length;
  return {
    done,
    total: eligible.length,
    percent: eligible.length ? Math.round((done / eligible.length) * 100) : 0,
  };
}
export function childProgress(tasks: Task[]) {
  const eligible = tasks.filter((t) => !t.deletedAt && t.status !== 'canceled');
  return { done: eligible.filter((t) => t.status === 'done').length, total: eligible.length };
}
export function workspaceToday(timeZone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function dueGroup(task: Task, today: string): 'Overdue' | 'Today' | 'Upcoming' | 'No date' {
  if (!task.dueDate) return 'No date';
  if (task.dueDate < today && isOpen(task.status)) return 'Overdue';
  return task.dueDate === today ? 'Today' : 'Upcoming';
}
export function isBlocked(task: Task, tasks: Task[]) {
  const blocker = tasks.find((t) => t.id === task.blockedById && !t.deletedAt);
  return !!blocker && isOpen(blocker.status);
}
export function effectiveMilestone(task: Task, tasks: Task[]) {
  return task.parentId
    ? (tasks.find((t) => t.id === task.parentId)?.milestoneId ?? null)
    : task.milestoneId;
}
export function dateLabel(value: string | null, today?: string) {
  if (!value) return 'No date';
  if (value === today) return 'Today';
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${value}T12:00:00Z`),
  );
}
