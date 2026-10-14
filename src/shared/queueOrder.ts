import type { Task } from './types';

/** The user's queue order first (lower first), then tasks with no order, oldest first. */
export function byQueueOrder(a: Task, b: Task): number {
  return (a.order ?? Infinity) - (b.order ?? Infinity) || a.createdAt.localeCompare(b.createdAt);
}
