import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { harness, waitFor, type Harness } from './helpers/manager';

let h: Harness;
beforeEach(async () => { h = await harness(); });
afterEach(async () => { await h.cleanup(); });

/** One slot, taken by a task that never finishes, so the rest stay queued. */
async function busyOffice() {
  const env = await h.make({ maxConcurrent: 1 });
  const { manager } = env;
  await manager.hire('frontend'); // Pixel
  await manager.hire('backend'); // Byte
  await manager.hire('qa'); // Quinn
  h.fakeEnv.FAKE_CLAUDE_HANG = '1';
  const a = await manager.createTask({ assignee: 'Pixel', title: 'a', brief: 'a', createdBy: 'boss' });
  await vi.waitFor(() => expect(manager.getTask(a.id)!.status).toBe('working'));
  delete h.fakeEnv.FAKE_CLAUDE_HANG;
  const b = await manager.createTask({ assignee: 'Byte', title: 'b', brief: 'b', createdBy: 'boss' });
  const c = await manager.createTask({ assignee: 'Quinn', title: 'c', brief: 'c', createdBy: 'boss' });
  await manager.idle();
  return { ...env, a, b, c };
}

describe('moveTask', () => {
  it('puts a task ahead in the queue so it starts first', async () => {
    const { manager, a, b, c } = await busyOffice();
    await manager.moveTask(c.id, b.id);
    expect(manager.getTask(c.id)!.order).toBeLessThan(manager.getTask(b.id)!.order!);
    const started = waitFor(manager, (e) => e.type === 'agent-event' && e.event.type === 'init' && e.agentId !== a.assigneeId);
    await manager.cancelTask(a.id);
    const ev = await started;
    expect(ev).toMatchObject({ agentId: c.assigneeId });
    expect(path.basename((await h.launches()).at(-1)!.cwd)).toBe('quinn');
  });

  it('moves to the end with no beforeId, and new tasks land after ordered ones', async () => {
    const { manager, b, c } = await busyOffice();
    await manager.moveTask(b.id, null);
    expect(manager.getTask(b.id)!.order).toBeGreaterThan(manager.getTask(c.id)!.order!);
    const d = await manager.createTask({ assignee: 'Quinn', title: 'd', brief: 'd', createdBy: 'boss' });
    expect(manager.getTask(d.id)!.order).toBeGreaterThan(manager.getTask(b.id)!.order!);
  });

  it('refuses tasks that are not queued and unknown neighbours', async () => {
    const { manager, a, b } = await busyOffice();
    await expect(manager.moveTask(a.id, b.id)).rejects.toThrow(/not queued/);
    await expect(manager.moveTask(b.id, 'T-999')).rejects.toThrow(/T-999/);
    await expect(manager.moveTask(b.id, b.id)).rejects.toThrow();
  });
});

describe('reassignTask', () => {
  it('hands an unstarted task to another employee with a branch of their own', async () => {
    const { manager, b, a } = await busyOffice();
    const moved = await manager.reassignTask(b.id, 'Quinn');
    const quinn = manager.findAgent('Quinn')!;
    expect(moved).toMatchObject({ assigneeId: quinn.id, branch: `ao/quinn/b-${b.id.toLowerCase()}` });
    const started = waitFor(manager, (e) => e.type === 'agent-event' && e.event.type === 'init' && e.agentId === quinn.id);
    await manager.cancelTask(a.id);
    await started;
  });

  it('refuses started tasks, the boss, unknown names and the same agent', async () => {
    const { manager, a, b } = await busyOffice();
    await manager.createBoss('Max');
    await expect(manager.reassignTask(a.id, 'Quinn')).rejects.toThrow(/started|not queued/);
    await expect(manager.reassignTask(b.id, 'Max')).rejects.toThrow(/No employee/);
    await expect(manager.reassignTask(b.id, 'Nobody')).rejects.toThrow(/No employee/);
    await expect(manager.reassignTask(b.id, 'Byte')).rejects.toThrow(/already/);
  });

  it('keeps an auto pick but takes the new role\'s pinned model', async () => {
    const env = await busyOffice();
    const { manager, roles, b, c } = env;
    const qa = (await roles.get('qa'))!;
    await roles.save({ ...qa, model: 'opus' });
    expect(manager.getTask(b.id)!.model).toBe('sonnet');
    const toQuinn = await manager.reassignTask(b.id, 'Quinn');
    expect(toQuinn).toMatchObject({ model: 'opus', modelPick: { source: 'role' } });
    const before = manager.getTask(c.id)!.model;
    expect(before).toBe('sonnet');
    const toPixel = await manager.reassignTask(c.id, 'Pixel');
    expect(toPixel.model).toBe(before);
  });
});
