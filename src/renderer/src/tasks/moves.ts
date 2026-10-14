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
