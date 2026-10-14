import { describe, expect, it } from 'vitest';
import { planFloor } from './floor';
import type { Agent, Task } from '../../../shared/types';

const agent = (id: string, over: Partial<Agent> = {}): Agent => ({ id, projectId: 'p', name: id.toUpperCase(), roleId: 'frontend', kind: 'employee', status: 'idle', bubble: 'Idle', ...over });
const boss = agent('boss', { kind: 'boss', name: 'Max', roleId: 'boss' });

describe('planFloor', () => {
  it('keeps working agents at their desks; idle ones go on a break or idle at their desk', () => {
    const plan = planFloor([boss, agent('a', { status: 'working', bubble: 'Editing x.ts' }), agent('b')], [], 1);
    const a = plan.desks.find((d) => d.agent.id === 'a')!;
    expect(a.away).toBe(false);
    expect(a.idle).toBeUndefined();
    const b = plan.desks.find((d) => d.agent.id === 'b')!;
    const inRoom = plan.cafeteria.some((c) => c.agent.id === 'b') || plan.play.some((p) => p.agent.id === 'b') || plan.washroom?.agent.id === 'b';
    expect(b.away).toBe(inRoom);
    if (!b.away) expect(b.idle).toBeDefined();
  });

  it('sends an idle agent to their desk for some slots and away for others', () => {
    const team = [agent('a')];
    const places = new Set<string>();
    const actions = new Set<string>();
    for (let slot = 0; slot < 60; slot++) {
      const d = planFloor(team, [], slot).desks[0];
      places.add(d.away ? 'away' : 'desk');
      if (d.idle) actions.add(d.idle.action);
    }
    expect([...places].sort()).toEqual(['away', 'desk']);
    expect(actions.size).toBeGreaterThan(1);
  });

  it('labels desk idle actions in plain words', () => {
    const team = Array.from({ length: 20 }, (_, i) => agent(`a${i}`));
    const labels = new Set(Array.from({ length: 40 }, (_, s) => planFloor(team, [], s).desks.flatMap((d) => (d.idle ? [d.idle.label] : [])) ).flat());
    expect([...labels].sort()).toEqual(['Checking phone', 'Reading docs', 'Sipping coffee', 'Stretching']);
  });

  it('keeps agents with queued, paused or stuck work at their desks', () => {
    const t = (assigneeId: string, over: Partial<Task>): Task => ({ id: 'T', projectId: 'p', title: 't', brief: '', assigneeId, createdBy: 'boss', status: 'queued', held: false, attempts: 0, branch: 'b', dependsOn: [], createdAt: '', updatedAt: '', ...over });
    const plan = planFloor([agent('q'), agent('h'), agent('s')], [t('q', {}), t('h', { held: true }), t('s', { status: 'needs_help' })], 1);
    expect(plan.desks.every((d) => !d.away)).toBe(true);
    expect(plan.cafeteria).toEqual([]);
  });

  it('treats a just-finished agent as free for a break', () => {
    const seen = new Set(Array.from({ length: 30 }, (_, s) => { const d = planFloor([agent('d', { status: 'done', bubble: 'Done' })], [], s).desks[0]; return d.away ? 'away' : d.idle ? 'idle' : 'busy'; }));
    expect(seen.has('busy')).toBe(false);
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
      const away = plan.desks.filter((d) => d.away).length;
      expect(plan.cafeteria.length + plan.play.length + (plan.washroom ? 1 : 0)).toBe(away);
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
      seen.add(p.washroom?.agent.id === 'a' ? 'washroom' : p.cafeteria.find((c) => c.agent.id === 'a')?.activity ?? `desk:${p.desks[0].idle?.action}`);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('labels each activity in plain words', () => {
    const team = Array.from({ length: 12 }, (_, i) => agent(`a${i}`));
    const labels = new Set(Array.from({ length: 30 }, (_, s) => planFloor(team, [], s).cafeteria.map((c) => c.label.replace(/ A\d+$/, ''))).flat());
    expect([...labels].sort()).toEqual(['Chatting with', 'Coffee break', 'Snack time']);
  });
});

describe('play area', () => {
  const team = Array.from({ length: 24 }, (_, i) => agent(`a${i}`));
  const slots = Array.from({ length: 80 }, (_, s) => planFloor(team, [], s));

  it('puts every away agent in exactly one room', () => {
    for (const plan of slots) {
      const ids = [...plan.cafeteria.map((c) => c.agent.id), ...plan.play.map((p) => p.agent.id), ...(plan.washroom ? [plan.washroom.agent.id] : [])];
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.length).toBe(plan.desks.filter((d) => d.away).length);
    }
  });

  it('pairs ping-pong players and names their opponent', () => {
    for (const plan of slots) {
      const players = plan.play.filter((p) => p.activity === 'pingpong');
      expect(players.length % 2).toBe(0);
      for (const p of players) expect(p.label).toMatch(/^Ping-pong with A\d+$/);
    }
  });

  it('lets one person on the arcade and two nap at most', () => {
    for (const plan of slots) {
      expect(plan.play.filter((p) => p.activity === 'arcade').length).toBeLessThanOrEqual(1);
      expect(plan.play.filter((p) => p.activity === 'nap').length).toBeLessThanOrEqual(2);
    }
  });

  it('uses every activity, with plain labels', () => {
    const seen = new Map(slots.flatMap((plan) => plan.play.map((p) => [p.activity, p.label] as const)));
    expect([...seen.keys()].sort()).toEqual(['arcade', 'gaming', 'nap', 'pingpong']);
    expect(seen.get('arcade')).toBe('High score run');
    expect(seen.get('gaming')).toBe('Gaming');
    expect(seen.get('nap')).toBe('Power nap');
  });

  it('sends about a quarter of idle agents to play', () => {
    const away = slots.reduce((n, p) => n + p.play.length, 0) / (team.length * slots.length);
    expect(away).toBeGreaterThan(0.15);
    expect(away).toBeLessThan(0.35);
  });
});
