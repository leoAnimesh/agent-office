import type { DiffStat, Task } from '../../../shared/types';

export type TaskAction = 'pause' | 'resume' | 'cancel';

export function taskActions(task: Task): TaskAction[] {
  const out: TaskAction[] = [];
  if (task.status === 'working') out.push('pause');
  if (task.status === 'queued' && task.held) out.push('resume');
  if (['queued', 'working', 'needs_help', 'review'].includes(task.status)) out.push('cancel');
  return out;
}

export function fileTotals(diff: DiffStat[] | undefined): { files: number; add: number; del: number } {
  const list = diff ?? [];
  return { files: list.length, add: list.reduce((n, f) => n + f.add, 0), del: list.reduce((n, f) => n + f.del, 0) };
}
