import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { BossSession, describeFinished, finishedChatText } from '../src/main/boss/bossSession';
import { ClaudeRunner } from '../src/main/claude/runner';
import type { ChatEntry, Task } from '../src/shared/types';
import { harness, type Harness } from './helpers/manager';
import { FAKE_CLAUDE } from './helpers/runner';

let h: Harness;
beforeEach(async () => { h = await harness(); });
afterEach(async () => { await h.cleanup(); });

async function setup() {
  const env = await h.make();
  await env.manager.createBoss('Max');
  const chat: ChatEntry[] = [];
  const boss = new BossSession({
    project: env.project, manager: env.manager, roles: env.roles, skills: env.skills, store: env.store,
    createRunner: (o) => new ClaudeRunner({ ...o, bin: process.execPath, binArgs: [FAKE_CLAUDE], env: { ...process.env, ...h.fakeEnv } }),
    claudeBin: 'claude', promptDir: h.paths.promptDir, mcpConfigPath: path.join(h.data, 'mcp.json'), isolateUserSettings: true,
  });
  boss.on('chat', (e) => chat.push(e));
  boss.start();
  const until = (pred: (e: ChatEntry) => boolean, ms = 20000) => new Promise<ChatEntry>((resolve, reject) => {
    const found = chat.find(pred);
    if (found) return resolve(found);
    const timer = setTimeout(() => reject(new Error('timed out waiting for chat')), ms);
    boss.on('chat', function l(e: ChatEntry) { if (pred(e)) { clearTimeout(timer); boss.off('chat', l); resolve(e); } });
  });
  return { ...env, boss, chat, until };
}

describe('BossSession', () => {
  it('never launches the boss with --model auto', async () => {
    const { boss, until, roles } = await setup();
    await roles.save({ ...(await roles.get('boss'))!, model: 'auto' });
    await boss.send('hello');
    await until((e) => e.kind === 'boss');
    const [launch] = await h.launches();
    expect(launch.argv[launch.argv.indexOf('--model') + 1]).toBe('opus');
    await boss.stop();
  });

  it('runs the boss in the repo with MCP, read-only tools and the boss prompt', async () => {
    const { boss, until } = await setup();
    await boss.send('Plan dark mode');
    await until((e) => e.kind === 'boss');
    const [launch] = await h.launches();
    expect(launch.argv).toEqual(expect.arrayContaining(['--mcp-config', path.join(h.data, 'mcp.json'), '--strict-mcp-config', '--model', 'opus']));
    const tools = launch.argv.slice(launch.argv.indexOf('--tools') + 1, launch.argv.indexOf('--allowedTools'));
    expect(tools).toEqual(['Read', 'Grep', 'Glob']);
    expect(launch.argv.slice(launch.argv.indexOf('--allowedTools') + 1)).toEqual(['mcp__agentoffice']);
    await boss.stop();
  });

  it('records the conversation and persists it', async () => {
    const { boss, chat, until, store, project } = await setup();
    await boss.send('Hello boss');
    await until((e) => e.kind === 'boss');
    expect(chat.map((e) => e.kind)).toEqual(['user', 'boss']);
    expect(chat[1]).toMatchObject({ text: 'echo: Hello boss' });
    expect((await store.readChat(project.id)).map((e) => e.kind)).toEqual(['user', 'boss']);
    expect((await boss.history()).length).toBe(2);
    await boss.stop();
  });

  it('tells the boss when an employee finishes', async () => {
    const { boss, manager, until } = await setup();
    await manager.hire('frontend');
    await manager.createTask({ assignee: 'Pixel', title: 'Toggle', brief: 'b', createdBy: 'boss' });
    const ev = await until((e) => e.kind === 'event');
    expect(ev).toMatchObject({ taskId: 'T-101', text: expect.stringContaining('T-101 by Pixel finished') });
    const reply = await until((e) => e.kind === 'boss');
    expect(reply).toMatchObject({ text: expect.stringContaining('[AgentOffice] T-101 by Pixel finished') });
    await boss.stop();
  });

  it('shows an error when the boss crashes and resumes on the next message', async () => {
    const { boss, until, chat } = await setup();
    h.fakeEnv.FAKE_CLAUDE_CRASH = '1';
    await boss.send('first');
    await until((e) => e.kind === 'error');
    expect(chat.find((e) => e.kind === 'error')).toMatchObject({ text: expect.stringContaining('will restart with your next message') });
    delete h.fakeEnv.FAKE_CLAUDE_CRASH;
    await boss.send('second');
    await until((e) => e.kind === 'boss');
    const launches = await h.launches();
    expect(launches).toHaveLength(2);
    expect(launches[1].argv).toContain('--resume');
    await boss.stop();
  });

  it('stop() returns only after the boss process has exited', async () => {
    const env = await h.make();
    await env.manager.createBoss('Max');
    let runner: ClaudeRunner | null = null;
    h.fakeEnv.FAKE_CLAUDE_HANG = '1';
    const boss = new BossSession({
      project: env.project, manager: env.manager, roles: env.roles, skills: env.skills, store: env.store,
      createRunner: (o) => (runner = new ClaudeRunner({ ...o, bin: process.execPath, binArgs: [FAKE_CLAUDE], env: { ...process.env, ...h.fakeEnv } })),
      claudeBin: 'claude', promptDir: h.paths.promptDir, mcpConfigPath: path.join(h.data, 'mcp.json'), isolateUserSettings: true,
    });
    boss.start();
    await boss.send('hang please');
    await boss.stop();
    expect(runner).not.toBeNull();
    expect(runner!.running).toBe(false);
  });

  it('starts a fresh boss session when the old one cannot be resumed', async () => {
    const { boss, manager, until, chat } = await setup();
    await manager.setSessionId(manager.findAgent('Max')!.id, 'gone-session');
    h.fakeEnv.FAKE_CLAUDE_RESUME_FAIL = '1';
    await boss.send('hello again');
    await until((e) => e.kind === 'boss');
    expect(chat.find((e) => e.kind === 'boss')).toMatchObject({ text: 'echo: hello again' });
    expect(chat.some((e) => e.kind === 'error' && /fresh boss session/.test(e.text))).toBe(true);
    const ls = await h.launches();
    expect(ls).toHaveLength(2);
    expect(ls[1].argv).toContain('--session-id');
    await boss.stop();
  });

  it('streams the reply in pieces, then saves the whole message once', async () => {
    const { boss, chat, until } = await setup();
    const pieces: (string | null)[] = [];
    boss.on('stream', (t: string | null) => pieces.push(t));
    await boss.send('Please write a longer answer for me');
    await until((e) => e.kind === 'boss');
    await new Promise((r) => setTimeout(r, 100));
    const texts = pieces.filter((p): p is string => p !== null);
    expect(texts.length).toBeGreaterThan(2);
    expect(texts.every((t, i) => i === 0 || t.startsWith(texts[i - 1]))).toBe(true);
    expect(texts.at(-1)).toBe('echo: Please write a longer answer for me');
    expect(pieces.at(-1)).toBeNull();
    expect(chat.filter((e) => e.kind === 'boss')).toEqual([expect.objectContaining({ text: 'echo: Please write a longer answer for me' })]);
    expect((await h.launches())[0].argv).toContain('--include-partial-messages');
    await boss.stop();
  });

  it('says when the boss is busy with a message', async () => {
    const { boss, until } = await setup();
    const busy: boolean[] = [];
    boss.on('busy', (b: boolean) => busy.push(b));
    await boss.send('hi');
    await until((e) => e.kind === 'boss');
    await new Promise((r) => setTimeout(r, 100));
    expect(busy).toEqual([true, false]);
    await boss.stop();
  });

  it('keeps reports in the chat', async () => {
    const { boss, chat } = await setup();
    await boss.report('Two of three tasks done');
    expect(chat).toEqual([expect.objectContaining({ kind: 'report', text: 'Two of three tasks done' })]);
    await boss.stop();
  });
});

describe('describeFinished', () => {
  it('summarises status, summary and files', () => {
    const t = { id: 'T-7', status: 'review', resultSummary: 'Added it', diffStat: [{ path: 'a.ts', add: 3, del: 1 }] } as Task;
    expect(describeFinished(t, 'Pixel')).toBe('T-7 by Pixel finished successfully. Summary: Added it Files: a.ts (+3 −1). Read it with get_task, then request_merge or message_agent.');
    expect(describeFinished({ ...t, status: 'needs_help', diffStat: [] }, 'Pixel')).toMatch(/^T-7 by Pixel finished with problems\. Summary: Added it Files: none\./);
  });
});

describe('finishedChatText', () => {
  const t = { id: 'T-7', status: 'review', resultSummary: '- **Checks:** `build` passed\n- Merged', diffStat: [{ path: 'a.ts', add: 3, del: 1 }] } as Task;

  it('is markdown for the user: heading, the summary as written, files as a list, no boss instructions', () => {
    expect(finishedChatText(t, 'Pixel')).toBe('**T-7 by Pixel finished successfully.**\n\n- **Checks:** `build` passed\n- Merged\n\n**Files changed (1)**\n- `a.ts` +3 −1');
    expect(finishedChatText({ ...t, status: 'needs_help', diffStat: [], resultSummary: '' }, 'Pixel')).toBe('**T-7 by Pixel finished with problems.**\n\nNo files changed.');
  });

  it('shortens long file lists', () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ path: `f${i}.ts`, add: 1, del: 0 }));
    const text = finishedChatText({ ...t, diffStat: many }, 'Pixel');
    expect(text).toContain('**Files changed (11)**');
    expect(text).toContain('- `f7.ts` +1 −0');
    expect(text).not.toContain('f8.ts');
    expect(text).toContain('- …and 3 more');
  });
});

describe('task-finished chat entry', () => {
  it('shows the markdown chat text while the boss still gets its instructions', async () => {
    const { manager, boss, chat, until } = await setup();
    await manager.hire('frontend');
    const t = await manager.createTask({ assignee: 'Pixel', title: 'a', brief: 'a', createdBy: 'boss' });
    const entry = await until((e) => e.kind === 'event' && e.taskId === t.id);
    if (entry.kind !== 'event') throw new Error('expected an event entry');
    expect(entry.text).toMatch(/^\*\*T-101 by Pixel finished successfully\.\*\*/);
    expect(entry.text).not.toContain('get_task');
    await until((e) => e.kind === 'boss' && e.text.includes('[AgentOffice] T-101 by Pixel finished successfully. Summary:'));
    expect(chat.filter((e) => e.kind === 'event')).toHaveLength(1);
    await boss.stop();
  });
});
