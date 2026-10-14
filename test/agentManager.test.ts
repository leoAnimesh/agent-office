import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentManager, type ManagerEvent } from '../src/main/agents/agentManager';
import { ClaudeRunner } from '../src/main/claude/runner';
import { WorktreeManager, git } from '../src/main/git/worktrees';
import { dataPaths } from '../src/main/store/paths';
import { ProjectStore } from '../src/main/store/projectStore';
import { RoleStore } from '../src/main/store/roleStore';
import { SkillStore } from '../src/main/store/skillStore';
import type { Project, Task } from '../src/shared/types';
import { makeRepo } from './helpers/repo';
import { FAKE_CLAUDE } from './helpers/runner';

let repo: string;
let data: string;
let argvOut: string;
let fakeEnv: Record<string, string>;
let project: Project;

async function makeManager(maxConcurrent = 4, store?: ProjectStore): Promise<AgentManager> {
  const paths = dataPaths(data);
  const roles = new RoleStore(paths.rolesDir);
  const skills = new SkillStore(paths.skillsDir);
  await roles.seed(path.resolve('resources/roles'));
  await skills.seed(path.resolve('resources/skills'));
  project = { id: 'p1', name: 'demo', repoPath: repo, baseBranch: 'main', maxConcurrent, bossCanHire: true, autoMerge: false };
  const m = new AgentManager({
    project, store: store ?? new ProjectStore(paths), roles, skills, worktrees: new WorktreeManager(repo),
    createRunner: (o) => new ClaudeRunner({ ...o, bin: process.execPath, binArgs: [FAKE_CLAUDE], env: { ...process.env, ...fakeEnv } }),
    claudeBin: 'claude', promptDir: paths.promptDir, isolateUserSettings: true,
  });
  await m.load();
  return m;
}

function waitFor(m: AgentManager, pred: (e: ManagerEvent) => boolean, ms = 20000): Promise<ManagerEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { m.off('event', l); reject(new Error('timed out')); }, ms);
    const l = (e: ManagerEvent) => { if (pred(e)) { clearTimeout(timer); m.off('event', l); resolve(e); } };
    m.on('event', l);
  });
}
const finished = (m: AgentManager, id: string) => waitFor(m, (e) => e.type === 'task-finished' && e.task.id === id);
const launches = async () => (await fs.readFile(argvOut, 'utf8').catch(() => '')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as { argv: string[] });

beforeEach(async () => {
  repo = await makeRepo();
  data = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-mgr-'));
  argvOut = path.join(data, 'argv.jsonl');
  fakeEnv = { FAKE_CLAUDE_ARGV_OUT: argvOut, FAKE_CLAUDE_FILE: 'notes.txt' };
});
afterEach(async () => {
  await fs.rm(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  await fs.rm(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

describe('AgentManager', () => {
  it('hires with pool names and rejects duplicates or unknown roles', async () => {
    const m = await makeManager();
    expect((await m.hire('frontend')).name).toBe('Pixel');
    expect((await m.hire('backend')).name).toBe('Byte');
    await expect(m.hire('qa', 'pixel')).rejects.toThrow(/already exists/);
    await expect(m.hire('nope')).rejects.toThrow(/Unknown role/);
    await m.shutdown();
  });

  it('rejects names that would share a worktree with an existing agent', async () => {
    const m = await makeManager();
    await m.hire('frontend', 'Zoë');
    await expect(m.hire('qa', 'Zoe')).rejects.toThrow(/too similar to Zoë/);
    await m.hire('qa', '🤖');
    await expect(m.hire('qa', 'Agent')).rejects.toThrow(/too similar/);
    await m.shutdown();
  });

  it('keeps going when the agent log cannot be written', async () => {
    class BrokenLogStore extends ProjectStore {
      override appendLog(): Promise<void> { return Promise.reject(new Error('disk full')); }
    }
    const m = await makeManager(4, new BrokenLogStore(dataPaths(data)));
    await m.hire('frontend');
    const first = finished(m, 'T-101');
    await m.createTask({ assignee: 'Pixel', title: 'a', brief: 'a', createdBy: 'user' });
    await first;
    const second = finished(m, 'T-102');
    await m.createTask({ assignee: 'Pixel', title: 'b', brief: 'b', createdBy: 'user' });
    await second;
    expect(m.tasks().map((t) => t.status)).toEqual(['review', 'review']);
    await m.shutdown();
  });

  it('runs a task in a worktree through to review with a diff and summary', async () => {
    const m = await makeManager();
    await m.createBoss('Max');
    const pixel = await m.hire('frontend');
    const done = finished(m, 'T-101');
    const task = await m.createTask({ assignee: 'pixel', title: 'Add theme toggle', brief: 'Make it.', createdBy: 'user' });
    expect(task.branch).toBe('ao/pixel/add-theme-toggle-t-101');
    await done;
    await m.idle();
    const t = m.tasks()[0];
    expect(t.status).toBe('review');
    expect(t.resultSummary).toMatch(/^echo: # Task T-101: Add theme toggle/);
    expect(t.diffStat).toEqual([{ path: 'notes.txt', add: 1, del: 0 }]);
    const agent = m.findAgent(pixel.id)!;
    expect(agent.sessionId).toBeTruthy();
    expect(agent.status).toBe('done');
    const [launch] = await launches();
    expect(launch.argv).toEqual(expect.arrayContaining(['--model', 'sonnet', '--setting-sources', 'project,local', '--append-system-prompt-file']));
    const promptFile = launch.argv[launch.argv.indexOf('--append-system-prompt-file') + 1];
    expect(await fs.readFile(promptFile, 'utf8')).toContain('Your boss is Max.');
    expect(await git(repo, ['status', '--porcelain'])).toBe('');
    await m.shutdown();
  });

  it('resumes the same session for the agent’s next task', async () => {
    const m = await makeManager();
    await m.hire('frontend');
    const first = finished(m, 'T-101');
    await m.createTask({ assignee: 'Pixel', title: 'one', brief: 'a', createdBy: 'user' });
    await first;
    await m.idle();
    const second = finished(m, 'T-102');
    await m.createTask({ assignee: 'Pixel', title: 'two', brief: 'b', createdBy: 'user' });
    await second;
    const [l1, l2] = await launches();
    const sid = l1.argv[l1.argv.indexOf('--session-id') + 1];
    expect(l2.argv).toEqual(expect.arrayContaining(['--resume', sid]));
    await m.shutdown();
  });

  it('never runs more than maxConcurrent sessions at once', async () => {
    fakeEnv.FAKE_CLAUDE_DELAY_MS = '150';
    fakeEnv.FAKE_CLAUDE_FIXTURE = path.resolve('test/fixtures/stream/read-file.jsonl');
    const m = await makeManager(1);
    await m.hire('frontend');
    await m.hire('backend');
    let peak = 0;
    m.on('event', () => { peak = Math.max(peak, m.tasks().filter((t) => t.status === 'working').length); });
    const both = Promise.all([finished(m, 'T-101'), finished(m, 'T-102')]);
    await m.createTask({ assignee: 'Pixel', title: 'a', brief: 'a', createdBy: 'user' });
    await m.createTask({ assignee: 'Byte', title: 'b', brief: 'b', createdBy: 'user' });
    expect(m.tasks().map((t) => t.status)).toEqual(['working', 'queued']);
    await both;
    expect(peak).toBe(1);
    await m.shutdown();
  });

  it('holds a dependent task until its dependency is done', async () => {
    const m = await makeManager();
    await m.hire('frontend');
    await m.hire('qa', 'Quinn');
    const first = finished(m, 'T-101');
    await m.createTask({ assignee: 'Pixel', title: 'build', brief: 'x', createdBy: 'boss' });
    await m.createTask({ assignee: 'Quinn', title: 'test it', brief: 'y', dependsOn: ['T-101'], createdBy: 'boss' });
    await first;
    await m.idle();
    expect(m.tasks().find((t) => t.id === 'T-102')!.status).toBe('queued');
    const second = finished(m, 'T-102');
    await m.markDone('T-101');
    await second;
    await m.shutdown();
  });

  it('rejects tasks for unknown agents or unknown dependencies', async () => {
    const m = await makeManager();
    await m.hire('frontend');
    await expect(m.createTask({ assignee: 'Nobody', title: 't', brief: 'b', createdBy: 'user' })).rejects.toThrow(/No employee named Nobody/);
    await expect(m.createTask({ assignee: 'Pixel', title: 't', brief: 'b', dependsOn: ['T-999'], createdBy: 'user' })).rejects.toThrow(/Unknown task T-999/);
    await m.shutdown();
  });

  it('marks a crashed session as needs_help with stderr, then keeps going', async () => {
    fakeEnv.FAKE_CLAUDE_CRASH = '1';
    const m = await makeManager(1);
    await m.hire('frontend');
    await m.hire('backend');
    const crashed = finished(m, 'T-101');
    await m.createTask({ assignee: 'Pixel', title: 'a', brief: 'a', createdBy: 'user' });
    delete fakeEnv.FAKE_CLAUDE_CRASH; // only T-101's runner was created with it
    await m.createTask({ assignee: 'Byte', title: 'b', brief: 'b', createdBy: 'user' });
    await crashed;
    const t1 = m.tasks().find((t) => t.id === 'T-101')!;
    expect(t1.status).toBe('needs_help');
    expect(t1.resultSummary).toContain('boom: simulated crash');
    await finished(m, 'T-102');
    expect(m.tasks().find((t) => t.id === 'T-102')!.status).toBe('review');
    await m.shutdown();
  });

  it('marks an error result as needs_help', async () => {
    fakeEnv.FAKE_CLAUDE_FAIL = '1';
    const m = await makeManager();
    await m.hire('frontend');
    const done = finished(m, 'T-101');
    await m.createTask({ assignee: 'Pixel', title: 'a', brief: 'a', createdBy: 'user' });
    await done;
    expect(m.tasks()[0]).toMatchObject({ status: 'needs_help', resultSummary: 'simulated failure' });
    await m.shutdown();
  });

  it('pauses and resumes a task, continuing the same session', async () => {
    fakeEnv.FAKE_CLAUDE_HANG = '1';
    const m = await makeManager();
    const pixel = await m.hire('frontend');
    const started = waitFor(m, (e) => e.type === 'agent-event' && e.event.type === 'init');
    await m.createTask({ assignee: 'Pixel', title: 'long', brief: 'x', createdBy: 'user' });
    await started;
    await m.pauseTask('T-101');
    await waitFor(m, (e) => e.type === 'agent-event' && e.event.type === 'exit');
    await m.idle();
    expect(m.tasks()[0]).toMatchObject({ status: 'queued', held: true });
    expect(m.findAgent(pixel.id)!.status).toBe('paused');
    delete fakeEnv.FAKE_CLAUDE_HANG;
    const done = finished(m, 'T-101');
    await m.resumeTask('T-101');
    await done;
    const [, l2] = await launches();
    expect(l2.argv).toContain('--resume');
    expect(m.tasks()[0].attempts).toBe(2);
    await m.shutdown();
  });

  it('cancels a running task', async () => {
    fakeEnv.FAKE_CLAUDE_HANG = '1';
    const m = await makeManager();
    await m.hire('frontend');
    const started = waitFor(m, (e) => e.type === 'agent-event' && e.event.type === 'init');
    await m.createTask({ assignee: 'Pixel', title: 'long', brief: 'x', createdBy: 'user' });
    await started;
    await m.cancelTask('T-101');
    await waitFor(m, (e) => e.type === 'agent-event' && e.event.type === 'exit');
    await m.idle();
    expect(m.tasks()[0].status).toBe('cancelled');
    await m.shutdown();
  });

  it('after a restart, re-queues tasks left working and runs each exactly once', async () => {
    const m1 = await makeManager();
    const pixel = await m1.hire('frontend');
    await m1.shutdown();
    const store = new ProjectStore(dataPaths(data));
    const stale: Task = {
      id: 'T-101', projectId: 'p1', title: 'stale', brief: 'Fix the stale widget.', assigneeId: pixel.id, createdBy: 'user', status: 'working',
      held: false, attempts: 1, branch: 'ao/pixel/stale-t-101', dependsOn: [], createdAt: '2026-10-14T10:00:00Z', updatedAt: '2026-10-14T10:00:00Z',
    };
    await store.saveTasks('p1', [stale]);
    const m2 = await makeManager();
    expect(m2.tasks()[0].status).toBe('queued');
    const done = finished(m2, 'T-101');
    await m2.pump();
    await done;
    await m2.idle();
    expect(await launches()).toHaveLength(1);
    expect(m2.tasks()[0].status).toBe('review');
    // A fresh session must still get the brief, not just "continue".
    expect(m2.tasks()[0].resultSummary).toContain('Fix the stale widget.');
    await m2.shutdown();
  });
});
