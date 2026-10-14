import { describe, expect, it } from 'vitest';
import { COLUMNS, cardMeta, filterTasks } from './board';
import type { Task } from '../../../shared/types';

const t = (over: Partial<Task>): Task => ({ id: 'T-1', projectId: 'p', title: 't', brief: '', assigneeId: 'a', createdBy: 'boss', status: 'queued', held: false, attempts: 0, branch: 'b', dependsOn: [], createdAt: '', updatedAt: '', ...over });

describe('task board helpers', () => {
  it('covers every status exactly once', () => {
    const all = COLUMNS.flatMap((c) => c.statuses).sort();
    expect(all).toEqual(['cancelled', 'done', 'failed', 'needs_help', 'queued', 'review', 'working']);
  });

  it('describes each card', () => {
    const dep = t({ id: 'T-0', status: 'working' });
    expect(cardMeta(t({ dependsOn: ['T-0'] }), [dep])).toBe('blocked by T-0');
    expect(cardMeta(t({ dependsOn: ['T-0'] }), [{ ...dep, status: 'done' }])).toBe('queued');
    expect(cardMeta(t({ held: true }), [])).toBe('paused');
    expect(cardMeta(t({ status: 'working', attempts: 1 }), [])).toBe('running');
    expect(cardMeta(t({ status: 'working', attempts: 3 }), [])).toBe('attempt 3');
    expect(cardMeta(t({ status: 'review', diffStat: [{ path: 'a', add: 1, del: 0 }, { path: 'b', add: 1, del: 0 }] }), [])).toBe('2 files');
    expect(cardMeta(t({ status: 'needs_help' }), [])).toBe('needs help');
    expect(cardMeta(t({ status: 'done' }), [])).toBe('merged');
    expect(cardMeta(t({ status: 'cancelled' }), [])).toBe('cancelled');
  });

  it('filters by assignee', () => {
    const list = [t({ id: 'A', assigneeId: 'x' }), t({ id: 'B', assigneeId: 'y' })];
    expect(filterTasks(list, 'all')).toHaveLength(2);
    expect(filterTasks(list, 'y').map((x) => x.id)).toEqual(['B']);
  });
});
