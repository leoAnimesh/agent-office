import { describe, expect, it } from 'vitest';
import { planFloor } from './floor';
import type { Agent, Task } from '../../../shared/types';

const agent = (id: string, over: Partial<Agent> = {}): Agent => ({ id, projectId: 'p', name: id.toUpperCase(), roleId: 'frontend', kind: 'employee', status: 'idle', bubble: 'Idle', ...over });
const boss = agent('boss', { kind: 'boss', name: 'Max', roleId: 'boss' });

describe('planFloor', () => {
  it('keeps working agents at their desks and sends idle ones on a break', () => {
    const plan = planFloor([boss, agent('a', { status: 'working', bubble: 'Editing x.ts' }), agent('b')], [], 1);
    expect(plan.desks.map((d) => [d.agent.id, d.away])).toEqual([['a', false], ['b', true]]);
    const away = [...plan.cafeteria.map((c) => c.agent.id), ...(plan.washroom ? [plan.washroom.agent.id] : [])];
    expect(away).toEqual(['b']);
  });

  it('keeps agents with queued, paused or stuck work at their desks', () => {
    const t = (assigneeId: string, over: Partial<Task>): Task => ({ id: 'T', projectId: 'p', title: 't', brief: '', assigneeId, createdBy: 'boss', status: 'queued', held: false, attempts: 0, branch: 'b', dependsOn: [], createdAt: '', updatedAt: '', ...over });
    const plan = planFloor([agent('q'), agent('h'), agent('s')], [t('q', {}), t('h', { held: true }), t('s', { status: 'needs_help' })], 1);
    expect(plan.desks.every((d) => !d.away)).toBe(true);
    expect(plan.cafeteria).toEqual([]);
  });

  it('treats a just-finished agent as free for a break', () => {
    const plan = planFloor([agent('d', { status: 'done', bubble: 'Done' })], [], 1);
    expect(plan.desks[0].away).toBe(true);
  });

  it('never moves the boss out of the corner office', () => {
    const plan = planFloor([boss], [], 1);
    expect(plan.boss).toMatchObject({ agent: { id: 'boss' } });
    expect(plan.cafeteria).toEqual([]);
    expect(plan.washroom).toBeNull();
  });

  it('lets at most one person use the washroom', () => {
    const team = Array.from({ length: 30 }, (_, i) => agent(`a${i}`));
    for (let slot = 0; slot < 50; slot++) {
      const plan = planFloor(team, [], slot);
      const inCafe = plan.cafeteria.length;
      expect(inCafe + (plan.washroom ? 1 : 0)).toBe(Math.min(30, 30));
      expect(plan.cafeteria.some((c) => c.agent.id === plan.washroom?.agent.id)).toBe(false);
    }
  });

  it('pairs people who are chatting and names their partner', () => {
    const team = Array.from({ length: 12 }, (_, i) => agent(`a${i}`));
    for (let slot = 0; slot < 30; slot++) {
      const chatting = planFloor(team, [], slot).cafeteria.filter((c) => c.activity === 'chat');
      expect(chatting.length % 2).toBe(0);
      for (const c of chatting) expect(c.label).toMatch(/^Chatting with A\d+$/);
    }
  });

  it('is stable within a time slot and varies across slots', () => {
    const team = [agent('a'), agent('b'), agent('c')];
    expect(planFloor(team, [], 7)).toEqual(planFloor(team, [], 7));
    const seen = new Set<string>();
    for (let slot = 0; slot < 40; slot++) {
      const p = planFloor(team, [], slot);
      seen.add(p.washroom?.agent.id === 'a' ? 'washroom' : p.cafeteria.find((c) => c.agent.id === 'a')!.activity);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('labels each activity in plain words', () => {
    const team = Array.from({ length: 12 }, (_, i) => agent(`a${i}`));
    const labels = new Set(Array.from({ length: 30 }, (_, s) => planFloor(team, [], s).cafeteria.map((c) => c.label.replace(/ A\d+$/, ''))).flat());
    expect([...labels].sort()).toEqual(['Chatting with', 'Coffee break', 'Snack time']);
  });
});
