import type { DiffStat, Task } from '../../../shared/types';
import { byQueueOrder } from '../../../shared/queueOrder';

export type TaskAction = 'merge' | 'pause' | 'resume' | 'cancel';

export function taskActions(task: Task): TaskAction[] {
  const out: TaskAction[] = [];
  if (task.status === 'review') out.push('merge');
  if (task.status === 'working') out.push('pause');
  if (task.status === 'queued' && task.held) out.push('resume');
  if (['queued', 'working', 'needs_help', 'review'].includes(task.status)) out.push('cancel');
  return out;
}

export function fileTotals(diff: DiffStat[] | undefined): { files: number; add: number; del: number } {
  const list = diff ?? [];
  return { files: list.length, add: list.reduce((n, f) => n + f.add, 0), del: list.reduce((n, f) => n + f.del, 0) };
}

/** The queued tasks in the order they will start. */
export function queueOf(tasks: Task[]): Task[] {
  return tasks.filter((t) => t.status === 'queued').sort(byQueueOrder);
}

/** The `beforeId` to pass to moveTask for one place up or down (null = to the end). */
export function queueNeighbours(task: Task, tasks: Task[]): { up: string | null; down: string | null; canUp: boolean; canDown: boolean } {
  const q = queueOf(tasks);
  const i = q.findIndex((t) => t.id === task.id);
  return {
    up: i > 0 ? q[i - 1].id : null,
    down: i >= 0 && i + 2 < q.length ? q[i + 2].id : null,
    canUp: i > 0,
    canDown: i >= 0 && i < q.length - 1,
  };
}

/** Only work nobody has started can change hands (a started task has commits on its agent's branch). */
export function canReassign(task: Task): boolean {
  return task.status === 'queued' && task.attempts === 0;
}
