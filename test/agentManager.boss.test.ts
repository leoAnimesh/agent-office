import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { finished, harness, waitFor, type Harness } from './helpers/manager';

let h: Harness;
beforeEach(async () => { h = await harness(); });
afterEach(async () => { await h.cleanup(); });

describe('AgentManager (boss support)', () => {
  it('treats a message to an agent with no open task as a question and reports the reply', async () => {
    const { manager } = await h.make();
    await manager.hire('frontend');
    const exited = waitFor(manager, (e) => e.type === 'agent-event' && e.event.type === 'exit');
    await manager.createTask({ assignee: 'Pixel', title: 'a', brief: 'a', createdBy: 'boss' });
    await exited;
    await manager.idle();
    const merged = await manager.merge('T-101');
    expect(merged).toMatchObject({ status: 'merged' });
    // The task remembers its merge commit so the History view can show it.
    expect(manager.getTask('T-101')!.mergeCommit).toBe((merged as { commit: string }).commit);
    const replied = waitFor(manager, (e) => e.type === 'agent-replied');
    expect(await manager.messageAgent('pixel', 'What did you learn?')).toEqual({ delivered: 'started', taskId: null });
    expect(await replied).toMatchObject({ type: 'agent-replied', text: expect.stringContaining('What did you learn?'), ok: true });
    expect((await h.launches()).at(-1)!.argv).toContain('--resume');
  });

  it('commits follow-up work on the reviewed task and reports it again', async () => {
    const { manager } = await h.make();
    await manager.hire('frontend');
    const exited = waitFor(manager, (e) => e.type === 'agent-event' && e.event.type === 'exit');
    await manager.createTask({ assignee: 'Pixel', title: 'a', brief: 'a', createdBy: 'boss' });
    await exited;
    await manager.idle();
    const again = finished(manager, 'T-101');
    expect(await manager.messageAgent('Pixel', 'Please also handle dark mode')).toEqual({ delivered: 'started', taskId: 'T-101' });
    expect(manager.getTask('T-101')!.status).toBe('working');
    const e = await again;
    expect(e).toMatchObject({ task: { status: 'review', resultSummary: expect.stringContaining('Please also handle dark mode') } });
    expect(await manager.merge('T-101')).toMatchObject({ status: 'merged' });
    expect(await fs.readFile(path.join(h.repo, 'notes.txt'), 'utf8')).toContain('Please also handle dark mode');
  });

  it('reopens a task that needs help when feedback arrives', async () => {
    const { manager } = await h.make();
    await manager.hire('frontend');
    h.fakeEnv.FAKE_CLAUDE_FAIL = '1';
    const exited = waitFor(manager, (e) => e.type === 'agent-event' && e.event.type === 'exit');
    await manager.createTask({ assignee: 'Pixel', title: 'a', brief: 'a', createdBy: 'boss' });
    await exited;
    await manager.idle();
    expect(manager.getTask('T-101')!.status).toBe('needs_help');
    delete h.fakeEnv.FAKE_CLAUDE_FAIL;
    const again = finished(manager, 'T-101');
    await manager.messageAgent('Pixel', 'Try again with the simpler approach');
    expect(await again).toMatchObject({ task: { status: 'review' } });
  });

  it('shutdown leaves running work for next time and starts nothing new', async () => {
    const { manager, store, project } = await h.make({ maxConcurrent: 1 });
    await manager.hire('frontend');
    await manager.hire('backend');
    h.fakeEnv.FAKE_CLAUDE_HANG = '1';
    const started = waitFor(manager, (e) => e.type === 'agent-event' && e.event.type === 'init');
    await manager.createTask({ assignee: 'Pixel', title: 'a', brief: 'a', createdBy: 'boss' });
    await manager.createTask({ assignee: 'Byte', title: 'b', brief: 'b', createdBy: 'boss' });
    await started;
    await manager.shutdown();
    await new Promise((r) => setTimeout(r, 300));
    expect(await h.launches()).toHaveLength(1);
    expect((await store.getTasks(project.id)).map((t) => t.status)).toEqual(['working', 'queued']);
    await expect(manager.createTask({ assignee: 'Byte', title: 'c', brief: 'c', createdBy: 'boss' })).rejects.toThrow(/closed/);
  });

  it('starts a fresh session when the saved one cannot be resumed', async () => {
    const { manager } = await h.make();
    const pixel = await manager.hire('frontend');
    await manager.setSessionId(pixel.id, 'gone-session');
    h.fakeEnv.FAKE_CLAUDE_RESUME_FAIL = '1';
    const done = finished(manager, 'T-101');
    await manager.createTask({ assignee: 'Pixel', title: 'a', brief: 'Do the thing', createdBy: 'boss' });
    const e = await done;
    expect(e).toMatchObject({ task: { status: 'review', resultSummary: expect.stringContaining('Do the thing') } });
    const ls = await h.launches();
    expect(ls).toHaveLength(2);
    expect(ls[0].argv).toContain('--resume');
    expect(ls[1].argv).toContain('--session-id');
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

  it('shutdown waits until running sessions have exited', async () => {
    const { manager } = await h.make();
    await manager.hire('frontend');
    h.fakeEnv.FAKE_CLAUDE_HANG = '1';
    const seen: string[] = [];
    manager.on('event', (e) => { if (e.type === 'agent-event') seen.push(e.event.type); });
    const started = waitFor(manager, (e) => e.type === 'agent-event' && e.event.type === 'init');
    await manager.createTask({ assignee: 'Pixel', title: 'a', brief: 'a', createdBy: 'boss' });
    await started;
    await manager.shutdown();
    expect(seen).toContain('exit');
  });

  it('tracks the boss session id and live status', async () => {
    const { manager } = await h.make();
    const boss = await manager.createBoss('Max');
    await manager.setSessionId(boss.id, 'sess-boss');
    await manager.setLive(boss.id, { type: 'tool_use', id: '1', name: 'mcp__agentoffice__assign_task', input: { agent: 'Pixel' } });
    expect(manager.findAgent('Max')).toMatchObject({ sessionId: 'sess-boss', status: 'working', bubble: 'Assigning Pixel' });
  });
});
