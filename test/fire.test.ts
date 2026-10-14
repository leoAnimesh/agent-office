import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { git } from '../src/main/git/worktrees';
import { finished, harness, waitFor, type Harness } from './helpers/manager';

let h: Harness;
beforeEach(async () => { h = await harness(); });
afterEach(async () => { await h.cleanup(); });

describe('AgentManager.fire', () => {
  it('fires an idle agent, removes their worktree and keeps their branch', async () => {
    const { manager } = await h.make();
    const pixel = await manager.hire('frontend');
    const exited = waitFor(manager, (e) => e.type === 'agent-event' && e.event.type === 'exit');
    const done = finished(manager, 'T-101');
    await manager.createTask({ assignee: 'Pixel', title: 'a', brief: 'a', createdBy: 'user' });
    await done;
    await exited;
    await manager.idle();
    expect(await manager.merge('T-101')).toMatchObject({ status: 'merged' });
    const wt = manager.findAgent(pixel.id)!.worktreePath!;
    await manager.fire(pixel.id);
    expect(manager.findAgent(pixel.id)).toBeUndefined();
    expect(existsSync(wt)).toBe(false);
    expect(await git(h.repo, ['branch', '--list', 'ao/pixel/*'])).toContain('ao/pixel/a-t-101');
    expect((await manager.hire('frontend')).name).toBe('Pixel');
  });

  it('refuses to fire someone with queued, running or unreviewed work', async () => {
    const { manager } = await h.make();
    const pixel = await manager.hire('frontend');
    h.fakeEnv.FAKE_CLAUDE_HANG = '1';
    const started = waitFor(manager, (e) => e.type === 'agent-event' && e.event.type === 'init');
    await manager.createTask({ assignee: 'Pixel', title: 'a', brief: 'a', createdBy: 'user' });
    await started;
    await expect(manager.fire(pixel.id)).rejects.toThrow(/Pixel still has open work: T-101/);
  });

  it('refuses to fire the boss', async () => {
    const { manager } = await h.make();
    const boss = await manager.createBoss('Max');
    await expect(manager.fire(boss.id)).rejects.toThrow(/boss cannot be fired/);
  });
});
