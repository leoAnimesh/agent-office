import type { Task } from '../../../shared/types';

export type Column = 'queued' | 'working' | 'needs_help' | 'review' | 'done';
export type MoveAction = 'merge' | 'pause' | 'resume' | 'cancel';

/** The board column a task sits in (failed shares Needs help, cancelled shares Done). */
export function columnOf(task: Task): Column {
  switch (task.status) {
    case 'failed': return 'needs_help';
    case 'cancelled': return 'done';
    default: return task.status;
  }
}

/** What dropping a task on a column does, or null when that move isn't allowed. */
export function dropAction(task: Task, to: Column): MoveAction | null {
  const from = columnOf(task);
  if (from === to) return null;
  if (from === 'review' && to === 'done') return 'merge';
  if (task.status === 'working' && to === 'queued') return 'pause';
  if (task.status === 'queued' && task.held && to === 'working') return 'resume';
  if (to === 'done' && from !== 'done') return 'cancel';
  return null;
}

/** Whether a column takes a drop: run an action, reorder the queue, or neither. */
export function dropMode(task: Task, to: Column): 'action' | 'reorder' | null {
  if (to === 'queued' && task.status === 'queued') return 'reorder';
  return dropAction(task, to) ? 'action' : null;
}

/**
 * Where a queued card dropped on the top or bottom half of another lands, as moveTask's `beforeId`
 * (null = the end), or undefined when the drop would leave the queue as it is.
 */
export function queueDropBefore(queue: string[], dragged: string, over: string, half: 'top' | 'bottom'): string | null | undefined {
  if (over === dragged) return undefined;
  const rest = queue.filter((id) => id !== dragged);
  const i = rest.indexOf(over);
  if (i < 0) return undefined;
  const before = half === 'top' ? over : rest[i + 1] ?? null;
  const at = queue.indexOf(dragged);
  const nowBefore = at >= 0 ? queue[at + 1] ?? null : undefined;
  return before === nowBefore ? undefined : before;
}
