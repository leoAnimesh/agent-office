import { describe, expect, it } from 'vitest';
import type { Task } from '../../../shared/types';
import { columnOf, dropAction } from './moves';

const t = (over: Partial<Task>): Task => ({ id: 'T-1', projectId: 'p', title: 'x', brief: '', assigneeId: 'a', createdBy: 'boss', status: 'queued', held: false, attempts: 0, branch: 'b', dependsOn: [], createdAt: '', updatedAt: '', ...over });

describe('columnOf', () => {
  it('puts failed with needs help and cancelled with done', () => {
    expect(columnOf(t({ status: 'failed' }))).toBe('needs_help');
    expect(columnOf(t({ status: 'cancelled' }))).toBe('done');
    expect(columnOf(t({ status: 'review' }))).toBe('review');
  });
});

describe('dropAction', () => {
  it('runs the action each allowed drop means', () => {
    expect(dropAction(t({ status: 'review' }), 'done')).toBe('merge');
    expect(dropAction(t({ status: 'working' }), 'queued')).toBe('pause');
    expect(dropAction(t({ status: 'queued', held: true }), 'working')).toBe('resume');
    expect(dropAction(t({ status: 'queued' }), 'done')).toBe('cancel');
    expect(dropAction(t({ status: 'working' }), 'done')).toBe('cancel');
    expect(dropAction(t({ status: 'needs_help' }), 'done')).toBe('cancel');
    expect(dropAction(t({ status: 'failed' }), 'done')).toBe('cancel');
  });
  it('refuses everything else', () => {
    expect(dropAction(t({ status: 'queued' }), 'queued')).toBeNull();
    expect(dropAction(t({ status: 'queued' }), 'working')).toBeNull();
    expect(dropAction(t({ status: 'review' }), 'working')).toBeNull();
    expect(dropAction(t({ status: 'needs_help' }), 'review')).toBeNull();
    expect(dropAction(t({ status: 'done' }), 'queued')).toBeNull();
    expect(dropAction(t({ status: 'cancelled' }), 'working')).toBeNull();
    expect(dropAction(t({ status: 'working' }), 'review')).toBeNull();
  });
});
