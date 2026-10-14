import { describe, expect, it } from 'vitest';
import type { Task } from '../../../shared/types';
import { canReassign, fileTotals, queueNeighbours, taskActions } from './taskDetail';

const t = (over: Partial<Task>): Task => ({ id: 'T-101', projectId: 'p', title: 'x', brief: '', assigneeId: 'a', createdBy: 'boss', status: 'queued', held: false, attempts: 0, branch: 'b', dependsOn: [], createdAt: '', updatedAt: '', ...over });

describe('taskActions', () => {
  it('offers the actions each status allows', () => {
    expect(taskActions(t({ status: 'working' }))).toEqual(['pause', 'cancel']);
    expect(taskActions(t({ status: 'queued', held: true }))).toEqual(['resume', 'cancel']);
    expect(taskActions(t({ status: 'queued' }))).toEqual(['cancel']);
    expect(taskActions(t({ status: 'needs_help' }))).toEqual(['cancel']);
    expect(taskActions(t({ status: 'done' }))).toEqual([]);
    expect(taskActions(t({ status: 'cancelled' }))).toEqual([]);
  });
});

describe('fileTotals', () => {
  it('sums the diff stat', () => {
    expect(fileTotals([{ path: 'a', add: 3, del: 1 }, { path: 'b', add: 2, del: 0 }])).toEqual({ files: 2, add: 5, del: 1 });
    expect(fileTotals(undefined)).toEqual({ files: 0, add: 0, del: 0 });
  });
});

describe('merge action', () => {
  it('offers merge for a task in review', () => {
    expect(taskActions(t({ status: 'review' }))).toEqual(['merge', 'cancel']);
  });
});

describe('queueNeighbours', () => {
  const q = [t({ id: 'A', order: 1 }), t({ id: 'B', order: 2 }), t({ id: 'C', order: 3 }), t({ id: 'X', status: 'working' })];
  it('gives the beforeId for moving one place up or down', () => {
    expect(queueNeighbours(q[1], q)).toEqual({ up: 'A', down: null, canUp: true, canDown: true });
    expect(queueNeighbours(q[0], q)).toEqual({ up: null, down: 'C', canUp: false, canDown: true });
    expect(queueNeighbours(q[2], q)).toEqual({ up: 'B', down: null, canUp: true, canDown: false });
  });
});

describe('canReassign', () => {
  it('only for queued tasks that have not started', () => {
    expect(canReassign(t({ status: 'queued', attempts: 0 }))).toBe(true);
    expect(canReassign(t({ status: 'queued', attempts: 1 }))).toBe(false);
    expect(canReassign(t({ status: 'working' }))).toBe(false);
  });
});
