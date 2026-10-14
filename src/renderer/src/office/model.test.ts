import { describe, expect, it } from 'vitest';
import { displayState, progress, splitTeam, statusCounts, whiteboard } from './model';
import type { Agent, Task } from '../../../shared/types';

const agent = (over: Partial<Agent>): Agent => ({ id: 'a1', projectId: 'p', name: 'Pixel', roleId: 'frontend', kind: 'employee', status: 'idle', bubble: 'Idle', ...over });
const task = (over: Partial<Task>): Task => ({ id: 'T-101', projectId: 'p', title: 'Toggle', brief: '', assigneeId: 'a1', createdBy: 'boss', status: 'queued', held: false, attempts: 0, branch: 'b', dependsOn: [], createdAt: '2026-10-14T10:00:00Z', updatedAt: '2026-10-14T10:00:00Z', ...over });

describe('displayState', () => {
  it('shows an idle agent with queued work as waiting', () => {
    expect(displayState(agent({}), [task({})])).toEqual({ status: 'waiting', bubble: 'Queued: Toggle' });
    expect(displayState(agent({}), [task({ dependsOn: ['T-100'] })])).toEqual({ status: 'waiting', bubble: 'Waiting on T-100' });
    expect(displayState(agent({}), [task({ held: true })])).toEqual({ status: 'paused', bubble: 'Paused: Toggle' });
  });

  it('passes live states through', () => {
    expect(displayState(agent({ status: 'working', bubble: 'Editing a.ts' }), [])).toEqual({ status: 'working', bubble: 'Editing a.ts' });
    expect(displayState(agent({}), [])).toEqual({ status: 'idle', bubble: 'Idle' });
  });
});

describe('whiteboard', () => {
  it('lists active work first with marks and owners, hiding cancelled tasks', () => {
    const agents = [agent({})];
    const lines = whiteboard([
      task({ id: 'T-1', title: 'Done thing', status: 'done' }),
      task({ id: 'T-2', title: 'Doing thing', status: 'working' }),
      task({ id: 'T-3', title: 'Broken thing', status: 'needs_help' }),
      task({ id: 'T-4', title: 'Gone', status: 'cancelled' }),
      task({ id: 'T-5', title: 'Check me', status: 'review' }),
    ], agents);
    expect(lines.map((l) => l.mark)).toEqual(['[>]', '[!]', '[?]', '[x]']);
    expect(lines[0]).toEqual({ mark: '[>]', text: 'Doing thing (Pixel)', tone: 'active' });
  });

  it('respects the limit', () => {
    const many = Array.from({ length: 10 }, (_, i) => task({ id: `T-${i}`, title: `t${i}` }));
    expect(whiteboard(many, [agent({})], 4)).toHaveLength(4);
  });
});

describe('counts', () => {
  it('counts live states and progress', () => {
    expect(statusCounts([{ status: 'working', bubble: '' }, { status: 'error', bubble: '' }, { status: 'paused', bubble: '' }, { status: 'waiting', bubble: '' }])).toEqual({ working: 1, thinking: 0, waiting: 2, problem: 1 });
    expect(progress([task({ status: 'done' }), task({ status: 'working' }), task({ status: 'cancelled' })])).toEqual({ done: 1, total: 2 });
  });

  it('splits the boss from employees', () => {
    const boss = agent({ id: 'b', kind: 'boss', name: 'Max' });
    expect(splitTeam([agent({}), boss])).toEqual({ boss, employees: [agent({})] });
  });
});
