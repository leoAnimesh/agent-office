import { describe, expect, it } from 'vitest';
import type { Task } from '../../../shared/types';
import { modelChip, roleModelLabel } from './modelChip';

const base: Task = { id: 'T-101', projectId: 'p', title: 'x', brief: '', assigneeId: 'a', createdBy: 'boss', status: 'queued', held: false, attempts: 0, branch: 'b', dependsOn: [], createdAt: '', updatedAt: '' };

describe('modelChip', () => {
  it('shows classifying while a queued task has no model', () => {
    expect(modelChip(base)).toEqual({ label: 'classifying…', title: 'Opus is picking a model for this task' });
  });
  it('labels classifier, role and fallback picks', () => {
    expect(modelChip({ ...base, model: 'opus', modelPick: { model: 'opus', size: 'large', reason: 'new subsystem', source: 'classifier' } })).toEqual({ label: 'opus · large', title: 'new subsystem' });
    expect(modelChip({ ...base, model: 'sonnet', modelPick: { model: 'sonnet', reason: 'Pinned by role', source: 'role' } })).toEqual({ label: 'sonnet · pinned', title: 'Pinned by role' });
    expect(modelChip({ ...base, model: 'sonnet', modelPick: { model: 'sonnet', reason: 'Classifier unavailable: timed out', source: 'fallback' } })).toEqual({ label: 'sonnet · fallback', title: 'Classifier unavailable: timed out' });
  });
  it('shows nothing for old tasks that never had a model', () => {
    expect(modelChip({ ...base, status: 'done' })).toBeNull();
  });
});

describe('roleModelLabel', () => {
  it('spells out auto', () => {
    expect(roleModelLabel('auto')).toBe('auto (per task)');
    expect(roleModelLabel('opus')).toBe('opus');
  });
});
