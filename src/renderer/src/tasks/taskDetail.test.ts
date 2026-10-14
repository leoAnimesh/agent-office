import { describe, expect, it } from 'vitest';
import type { Task } from '../../../shared/types';
import { fileTotals, taskActions } from './taskDetail';

const t = (over: Partial<Task>): Task => ({ id: 'T-101', projectId: 'p', title: 'x', brief: '', assigneeId: 'a', createdBy: 'boss', status: 'queued', held: false, attempts: 0, branch: 'b', dependsOn: [], createdAt: '', updatedAt: '', ...over });

describe('taskActions', () => {
  it('offers the actions each status allows', () => {
    expect(taskActions(t({ status: 'working' }))).toEqual(['pause', 'cancel']);
    expect(taskActions(t({ status: 'queued', held: true }))).toEqual(['resume', 'cancel']);
    expect(taskActions(t({ status: 'queued' }))).toEqual(['cancel']);
    expect(taskActions(t({ status: 'review' }))).toEqual(['cancel']);
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
