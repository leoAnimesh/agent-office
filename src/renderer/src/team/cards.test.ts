import { describe, expect, it } from 'vitest';
import type { Agent, Role, Task } from '../../../shared/types';
import { teamCard, teamSummary } from './cards';

const agent = (over: Partial<Agent> = {}): Agent => ({ id: 'a', projectId: 'p', name: 'Fern', roleId: 'frontend', kind: 'employee', status: 'idle', bubble: 'Idle', ...over });
const role = { id: 'frontend', model: 'auto' } as Role;
let n = 0;
const task = (over: Partial<Task>): Task => ({ id: `T-${100 + ++n}`, projectId: 'p', title: 't', brief: '', assigneeId: 'a', createdBy: 'boss', status: 'queued', held: false, attempts: 0, branch: 'b', dependsOn: [], createdAt: `2026-10-15T10:00:0${n % 10}Z`, updatedAt: '', ...over });

describe('teamCard', () => {
  it('shows the task being worked on, the model picked for it, and tasks done', () => {
    const tasks = [task({ id: 'T-1', status: 'done' }), task({ id: 'T-2', status: 'done' }), task({ id: 'T-3', status: 'working', title: 'Sync', model: 'haiku' }), task({ id: 'T-9', assigneeId: 'other', status: 'done' })];
    expect(teamCard(agent({ status: 'working', bubble: 'Editing sync.ts' }), tasks, role)).toEqual({
      status: 'working', label: 'Working', bubble: 'Editing sync.ts', task: { id: 'T-3', title: 'Sync' }, model: 'auto · haiku', done: 2,
    });
  });

  it('falls back to a stuck, reviewed, then queued task', () => {
    expect(teamCard(agent(), [task({ id: 'T-4', status: 'needs_help', title: 'Tests' })], role)).toMatchObject({ status: 'error', label: 'Needs help', task: { id: 'T-4' } });
    expect(teamCard(agent(), [task({ id: 'T-5', status: 'review', title: 'Copy' })], role)).toMatchObject({ task: { id: 'T-5' } });
    expect(teamCard(agent(), [task({ id: 'T-6', status: 'queued', title: 'Next' })], role)).toMatchObject({ status: 'waiting', task: { id: 'T-6' } });
  });

  it('shows nothing current and the plain model when idle', () => {
    expect(teamCard(agent(), [], role)).toMatchObject({ status: 'idle', label: 'Idle', task: null, model: 'auto', done: 0 });
    expect(teamCard(agent({ kind: 'boss', roleId: 'boss' }), [], { id: 'boss', model: 'opus' } as Role)).toMatchObject({ model: 'opus' });
    expect(teamCard(agent(), [], undefined).model).toBe('');
  });
});

describe('teamSummary', () => {
  it('counts what the team is doing right now', () => {
    const agents = [agent({ id: 'a', status: 'working' }), agent({ id: 'b', status: 'thinking' }), agent({ id: 'c' }), agent({ id: 'boss', kind: 'boss', status: 'working' })];
    const tasks = [task({ status: 'needs_help' }), task({ status: 'failed' }), task({ status: 'review' }), task({ status: 'queued' }), task({ status: 'queued' }), task({ status: 'done' }), task({ status: 'cancelled' })];
    expect(teamSummary(agents, tasks)).toEqual({ working: 2, needsHelp: 2, review: 1, queued: 2, merged: 1 });
  });
});
