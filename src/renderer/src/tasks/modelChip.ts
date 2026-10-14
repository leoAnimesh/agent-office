import { AUTO_MODEL, type Task } from '../../../shared/types';

export function modelChip(task: Task): { label: string; title: string } | null {
  if (!task.model) return task.status === 'queued' ? { label: 'classifying…', title: 'Opus is picking a model for this task' } : null;
  const p = task.modelPick;
  const tag = p?.source === 'role' ? 'pinned' : p?.source === 'fallback' ? 'fallback' : p?.size ?? 'auto';
  return { label: `${task.model} · ${tag}`, title: p?.reason ?? '' };
}

export function roleModelLabel(model: string): string {
  return model === AUTO_MODEL ? 'auto (per task)' : model;
}
