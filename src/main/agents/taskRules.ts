import type { Task, TaskStatus } from '../../shared/types';

const NEXT: Record<TaskStatus, TaskStatus[]> = {
  queued: ['working', 'cancelled'],
  working: ['review', 'needs_help', 'queued', 'cancelled'],
  needs_help: ['queued', 'failed', 'cancelled'],
  review: ['done', 'queued', 'cancelled'],
  done: [],
  failed: [],
  cancelled: [],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return NEXT[from].includes(to);
}

export function assertTransition(task: Task, to: TaskStatus): void {
  if (!canTransition(task.status, to)) throw new Error(`Task ${task.id}: cannot go from ${task.status} to ${to}`);
}

export function runnableTasks(tasks: Task[], busyAgentIds: ReadonlySet<string>, maxConcurrent: number): Task[] {
  const done = new Set(tasks.filter((t) => t.status === 'done').map((t) => t.id));
  let slots = maxConcurrent - tasks.filter((t) => t.status === 'working').length;
  const claimed = new Set(busyAgentIds);
  const picked: Task[] = [];
  const queued = tasks.filter((t) => t.status === 'queued' && !t.held).sort(byQueueOrder);
  for (const t of queued) {
    if (slots <= 0) break;
    if (claimed.has(t.assigneeId)) continue;
    if (!t.dependsOn.every((d) => done.has(d))) continue;
    if (!t.model) { claimed.add(t.assigneeId); continue; }   // still classifying: hold the agent's place in line
    picked.push(t);
    claimed.add(t.assigneeId);
    slots--;
  }
  return picked;
}

/** The user's queue order first (lower first), then tasks with no order, oldest first. */
export function byQueueOrder(a: Task, b: Task): number {
  return (a.order ?? Infinity) - (b.order ?? Infinity) || a.createdAt.localeCompare(b.createdAt);
}
