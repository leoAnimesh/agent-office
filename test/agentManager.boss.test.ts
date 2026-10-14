import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { finished, harness, waitFor, type Harness } from './helpers/manager';

let h: Harness;
beforeEach(async () => { h = await harness(); });
afterEach(async () => { await h.cleanup(); });

describe('AgentManager (boss support)', () => {
  it('messages an idle agent by resuming its session and reports the reply', async () => {
    const { manager } = await h.make();
    await manager.hire('frontend');
    const exited = waitFor(manager, (e) => e.type === 'agent-event' && e.event.type === 'exit');
    await manager.createTask({ assignee: 'Pixel', title: 'a', brief: 'a', createdBy: 'boss' });
    await exited;
    await manager.idle();
    const replied = waitFor(manager, (e) => e.type === 'agent-replied');
    expect(await manager.messageAgent('pixel', 'Please also add a test')).toBe('started');
    const r = await replied;
    expect(r).toMatchObject({ type: 'agent-replied', text: 'echo: Please also add a test', ok: true });
    const last = (await h.launches()).at(-1)!;
    expect(last.argv).toContain('--resume');
  });

  it('refuses to message an agent that never worked', async () => {
    const { manager } = await h.make();
    await manager.hire('frontend');
    await expect(manager.messageAgent('Pixel', 'hi')).rejects.toThrow(/has not worked on anything yet/);
    await expect(manager.messageAgent('Nobody', 'hi')).rejects.toThrow(/No employee named Nobody/);
  });

  it('merges a reviewed task, marks it done and starts its dependents', async () => {
    const { manager } = await h.make();
    await manager.hire('frontend');
    await manager.hire('qa', 'Quinn');
    const done = finished(manager, 'T-101');
    await manager.createTask({ assignee: 'Pixel', title: 'build', brief: 'x', createdBy: 'boss' });
    await manager.createTask({ assignee: 'Quinn', title: 'test', brief: 'y', dependsOn: ['T-101'], createdBy: 'boss' });
    await done;
    await manager.idle();
    const second = finished(manager, 'T-102');
    expect(await manager.merge('T-101')).toMatchObject({ status: 'merged' });
    expect(manager.getTask('T-101')!.status).toBe('done');
    expect(await fs.readFile(path.join(h.repo, 'notes.txt'), 'utf8')).toContain('turn 1');
    await second;
  });

  it('will not merge a task that is not in review', async () => {
    const { manager } = await h.make();
    await manager.hire('frontend');
    h.fakeEnv.FAKE_CLAUDE_HANG = '1';
    const started = waitFor(manager, (e) => e.type === 'agent-event' && e.event.type === 'init');
    await manager.createTask({ assignee: 'Pixel', title: 'a', brief: 'a', createdBy: 'boss' });
    await started;
    expect(await manager.merge('T-101')).toMatchObject({ status: 'not_ready' });
  });

  it('tracks the boss session id and live status', async () => {
    const { manager } = await h.make();
    const boss = await manager.createBoss('Max');
    await manager.setSessionId(boss.id, 'sess-boss');
    await manager.setLive(boss.id, { type: 'tool_use', id: '1', name: 'mcp__agentoffice__assign_task', input: { agent: 'Pixel' } });
    expect(manager.findAgent('Max')).toMatchObject({ sessionId: 'sess-boss', status: 'working', bubble: 'Assigning Pixel' });
  });
});
