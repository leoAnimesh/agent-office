import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { BossSession } from '../src/main/boss/bossSession';
import { ClaudeRunner } from '../src/main/claude/runner';
import type { ChatEntry } from '../src/shared/types';
import { harness, waitFor, type Harness } from './helpers/manager';

let h: Harness;
beforeEach(async () => { h = await harness(); });
afterEach(async () => { await h.cleanup(); });

describe('polish', () => {
  it('does not broadcast expected mistakes as app errors', async () => {
    const { manager } = await h.make();
    const errors: string[] = [];
    manager.on('event', (e) => { if (e.type === 'error') errors.push(e.message); });
    await expect(manager.createTask({ assignee: 'Nobody', title: 't', brief: 'b', createdBy: 'boss' })).rejects.toThrow(/No employee named/);
    await expect(manager.hire('nope')).rejects.toThrow(/Unknown role/);
    await manager.idle();
    expect(errors).toEqual([]);
  });

  it('says the boss could not start instead of "stopped (null)"', async () => {
    const env = await h.make();
    await env.manager.createBoss('Max');
    const chat: ChatEntry[] = [];
    const boss = new BossSession({
      project: env.project, manager: env.manager, roles: env.roles, skills: env.skills, store: env.store,
      createRunner: (o) => new ClaudeRunner({ ...o, bin: path.join(h.data, 'no-such-claude') }),
      claudeBin: 'claude', promptDir: h.paths.promptDir, mcpConfigPath: path.join(h.data, 'mcp.json'), isolateUserSettings: true,
    });
    boss.on('chat', (e) => chat.push(e));
    boss.start();
    await boss.send('hi');
    const deadline = Date.now() + 10_000;
    while (!chat.some((e) => e.kind === 'error') && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    expect(chat.find((e) => e.kind === 'error')).toMatchObject({ text: expect.stringContaining('could not start') });
    await boss.stop();
  });

  it('words a failed employee reply as a failure', async () => {
    const env = await h.make();
    await env.manager.createBoss('Max');
    const chat: ChatEntry[] = [];
    const boss = new BossSession({
      project: env.project, manager: env.manager, roles: env.roles, skills: env.skills, store: env.store,
      createRunner: (o) => new ClaudeRunner({ ...o, bin: process.execPath, binArgs: [path.resolve('test/fake-claude/fake-claude.mjs')], env: { ...process.env, ...h.fakeEnv } }),
      claudeBin: 'claude', promptDir: h.paths.promptDir, mcpConfigPath: path.join(h.data, 'mcp.json'), isolateUserSettings: true,
    });
    boss.on('chat', (e) => chat.push(e));
    boss.start();
    const pixel = await env.manager.hire('frontend');
    env.manager.emit('event', { type: 'agent-replied', agent: pixel, text: 'simulated failure', ok: false });
    await waitFor(env.manager, () => chat.some((e) => e.kind === 'event'), 5000).catch(() => undefined);
    expect(chat.find((e) => e.kind === 'event')).toMatchObject({ text: 'Pixel could not answer: simulated failure' });
    await boss.stop();
  });
});
