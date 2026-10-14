import { describe, expect, it } from 'vitest';
import { assertTransition, canTransition, runnableTasks } from './taskRules';
import type { Task } from '../../shared/types';

let n = 0;
const t = (over: Partial<Task>): Task => ({
  id: `T-${101 + n}`, projectId: 'p', title: 'x', brief: '', assigneeId: 'a1', createdBy: 'user', status: 'queued',
  held: false, attempts: 0, branch: 'b', dependsOn: [], createdAt: `2026-10-14T10:00:${String(n++).padStart(2, '0')}Z`, updatedAt: '', model: 'sonnet', ...over,
});

describe('transitions', () => {
  it('allows the normal lifecycle and rejects skipping steps', () => {
    expect(canTransition('queued', 'working')).toBe(true);
    expect(canTransition('working', 'review')).toBe(true);
    expect(canTransition('review', 'done')).toBe(true);
    expect(canTransition('queued', 'done')).toBe(false);
    expect(canTransition('done', 'queued')).toBe(false);
    expect(() => assertTransition(t({ id: 'T-9', status: 'done' }), 'working')).toThrow('Task T-9: cannot go from done to working');
  });
});

describe('runnableTasks', () => {
  it('skips a task that is still being classified, and keeps later tasks for that agent behind it', () => {
    const tasks = [
      t({ id: 'A', assigneeId: 'a1', model: undefined }),
      t({ id: 'B', assigneeId: 'a1' }),
      t({ id: 'C', assigneeId: 'a2' }),
    ];
    expect(runnableTasks(tasks, new Set(), 4).map((x) => x.id)).toEqual(['C']);
  });

  it('an unclassified task does not use a concurrency slot', () => {
    const tasks = [
      t({ id: 'A', assigneeId: 'a1', model: undefined }),
      t({ id: 'B', assigneeId: 'a2' }),
    ];
    expect(runnableTasks(tasks, new Set(), 1).map((x) => x.id)).toEqual(['B']);
  });

  it('picks oldest first, one task per agent, within the concurrency limit', () => {
    const tasks = [
      t({ id: 'A', assigneeId: 'a1' }),
      t({ id: 'B', assigneeId: 'a1' }),
      t({ id: 'C', assigneeId: 'a2' }),
      t({ id: 'D', assigneeId: 'a3' }),
    ];
    expect(runnableTasks(tasks, new Set(), 2).map((x) => x.id)).toEqual(['A', 'C']);
  });

  it('counts tasks already working against the limit and skips busy agents', () => {
    const tasks = [t({ id: 'W', status: 'working', assigneeId: 'a1' }), t({ id: 'Q1', assigneeId: 'a1' }), t({ id: 'Q2', assigneeId: 'a2' })];
    expect(runnableTasks(tasks, new Set(['a1']), 2).map((x) => x.id)).toEqual(['Q2']);
    expect(runnableTasks(tasks, new Set(['a1']), 1)).toEqual([]);
  });

  it('waits for dependencies to be done, and skips held tasks', () => {
    const tasks = [
      t({ id: 'D1', status: 'review', assigneeId: 'a1' }),
      t({ id: 'X', assigneeId: 'a2', dependsOn: ['D1'] }),
      t({ id: 'H', assigneeId: 'a3', held: true }),
    ];
    expect(runnableTasks(tasks, new Set(), 4)).toEqual([]);
    tasks[0].status = 'done';
    expect(runnableTasks(tasks, new Set(), 4).map((x) => x.id)).toEqual(['X']);
  });
});

describe('runnableTasks order', () => {
  it('starts ordered tasks first, lowest order first, then the rest oldest first', () => {
    const tasks = [
      t({ id: 'old', assigneeId: 'a1' }),
      t({ id: 'second', assigneeId: 'a2', order: 2 }),
      t({ id: 'first', assigneeId: 'a3', order: 1 }),
      t({ id: 'newer', assigneeId: 'a4' }),
    ];
    expect(runnableTasks(tasks, new Set(), 4).map((x) => x.id)).toEqual(['first', 'second', 'old', 'newer']);
    expect(runnableTasks(tasks, new Set(), 1).map((x) => x.id)).toEqual(['first']);
  });

  it('still skips held tasks and unmet dependencies, whatever their order', () => {
    const tasks = [
      t({ id: 'held', assigneeId: 'a1', order: 1, held: true }),
      t({ id: 'blocked', assigneeId: 'a2', order: 2, dependsOn: ['nope'] }),
      t({ id: 'free', assigneeId: 'a3', order: 3 }),
    ];
    expect(runnableTasks(tasks, new Set(), 4).map((x) => x.id)).toEqual(['free']);
  });
});
