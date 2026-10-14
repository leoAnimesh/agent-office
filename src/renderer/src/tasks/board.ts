import type { Task, TaskStatus } from '../../../shared/types';

export const COLUMNS: { title: string; statuses: TaskStatus[]; color: string }[] = [
  { title: 'Queued', statuses: ['queued'], color: 'var(--muted)' },
  { title: 'Working', statuses: ['working'], color: 'var(--teal)' },
  { title: 'Needs help', statuses: ['needs_help', 'failed'], color: 'var(--red)' },
  { title: 'Review', statuses: ['review'], color: 'var(--amber)' },
  { title: 'Done', statuses: ['done', 'cancelled'], color: 'var(--green)' },
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
