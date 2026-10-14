import type { Task, TaskStatus } from '../../../shared/types';
import type { Column } from './moves';

export const COLUMNS: { key: Column; title: string; statuses: TaskStatus[]; color: string }[] = [
  { key: 'queued', title: 'Queued', statuses: ['queued'], color: 'var(--muted)' },
  { key: 'working', title: 'Working', statuses: ['working'], color: 'var(--teal)' },
  { key: 'needs_help', title: 'Needs help', statuses: ['needs_help', 'failed'], color: 'var(--red)' },
  { key: 'review', title: 'Review', statuses: ['review'], color: 'var(--amber)' },
  { key: 'done', title: 'Done', statuses: ['done', 'cancelled'], color: 'var(--green)' },
];

export function cardMeta(task: Task, tasks: Task[]): string {
  switch (task.status) {
    case 'queued': {
      if (task.held) return 'paused';
      const blocking = task.dependsOn.filter((id) => tasks.find((x) => x.id === id)?.status !== 'done');
      return blocking.length > 0 ? `blocked by ${blocking.join(', ')}` : 'queued';
    }
    case 'working': return task.attempts > 1 ? `attempt ${task.attempts}` : 'running';
    case 'review': return `${task.diffStat?.length ?? 0} files`;
    case 'needs_help':
    case 'failed': return 'needs help';
    case 'done': return 'merged';
    case 'cancelled': return 'cancelled';
  }
}

export function filterTasks(tasks: Task[], assigneeId: string | 'all'): Task[] {
  return assigneeId === 'all' ? tasks : tasks.filter((t) => t.assigneeId === assigneeId);
}
