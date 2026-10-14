import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectService, projectIdFor } from '../src/main/workspace/projectService';
import { dataPaths } from '../src/main/store/paths';
import type { WorkspaceEvent } from '../src/shared/types';
import { makeRepo } from './helpers/repo';
import { FAKE_CLAUDE } from './helpers/runner';

let repo: string;
let data: string;
let svc: ProjectService;
let events: WorkspaceEvent[];
const fakeEnv: Record<string, string> = {};

beforeEach(async () => {
  repo = await makeRepo();
  data = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-svc-'));
  for (const k of Object.keys(fakeEnv)) delete fakeEnv[k];
  fakeEnv.FAKE_CLAUDE_FILE = 'notes.txt';
  svc = new ProjectService({ paths: dataPaths(data), resourcesDir: path.resolve('resources'), claudeBin: process.execPath, claudeBinArgs: [FAKE_CLAUDE], claudeEnv: fakeEnv as NodeJS.ProcessEnv });
  await svc.init();
  events = [];
  svc.on('event', (e) => events.push(e));
});
afterEach(async () => {
  await svc.close();
  await fs.rm(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  await fs.rm(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const until = (pred: (e: WorkspaceEvent) => boolean, ms = 20000) => new Promise<WorkspaceEvent>((resolve, reject) => {
  const hit = events.find(pred);
  if (hit) return resolve(hit);
  const timer = setTimeout(() => reject(new Error('timed out waiting for workspace event')), ms);
  svc.on('event', function l(e: WorkspaceEvent) { if (pred(e)) { clearTimeout(timer); svc.off('event', l); resolve(e); } });
});
const tool = (name: string, args: unknown = {}) => svc.tools().find((t) => t.name === name)!.run(args);

describe('ProjectService', () => {
  it('rejects a folder that is not a git repo', async () => {
    const plain = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-plain-'));
    await expect(svc.open(plain)).rejects.toThrow(/not a git repository/);
    expect(svc.current()).toBeNull();
  });

  it('opens a repo with a boss, seeded roles and a stable id', async () => {
    const snap = await svc.open(repo);
    expect(snap.project).toMatchObject({ id: projectIdFor(repo), name: path.basename(repo), baseBranch: 'main', autoMerge: false });
    expect(snap.agents).toEqual([expect.objectContaining({ kind: 'boss', name: 'Max' })]);
    expect((await svc.listRoles()).length).toBe(8);
    await svc.sendToBoss('hello');
    await until((e) => e.type === 'chat' && e.entry.kind === 'boss');
    await svc.close();
    const again = await svc.open(repo);
    expect(again.project.id).toBe(snap.project.id);
    expect(again.agents.filter((a) => a.kind === 'boss')).toHaveLength(1);
    expect(again.chat.map((c) => c.kind)).toEqual(['user', 'boss']);
  });

  it('asks the user before merging, then merges and tells the boss', async () => {
    await svc.open(repo);
    await tool('hire', { role_id: 'frontend' });
    await tool('assign_task', { agent: 'Pixel', title: 'Notes', brief: 'write notes' });
    await until((e) => e.type === 'tasks' && e.tasks.some((t) => t.id === 'T-101' && t.status === 'review'));
    expect(await tool('request_merge', { task_id: 'T-101' })).toMatchObject({ status: 'awaiting_user_approval' });
    const ask = (await until((e) => e.type === 'merge-request')) as Extract<WorkspaceEvent, { type: 'merge-request' }>;
    expect(ask.request).toMatchObject({ taskId: 'T-101', agentName: 'Pixel', diffStat: [{ path: 'notes.txt', add: 1, del: 0 }] });
    expect((await svc.snapshot()).merges).toHaveLength(1);
    await svc.answerMerge(ask.request.requestId, true);
    await until((e) => e.type === 'chat' && e.entry.kind === 'event' && /Merge of T-101: merged/.test(e.entry.text));
    expect((await svc.snapshot()).tasks.find((t) => t.id === 'T-101')!.status).toBe('done');
    expect(await fs.readFile(path.join(repo, 'notes.txt'), 'utf8')).toContain('turn 1');
    expect((await svc.snapshot()).merges).toEqual([]);
  });

  it('tells the boss when the user declines or the merge is blocked', async () => {
    await svc.open(repo);
    await tool('hire', { role_id: 'frontend' });
    await tool('assign_task', { agent: 'Pixel', title: 'Notes', brief: 'write notes' });
    await until((e) => e.type === 'tasks' && e.tasks.some((t) => t.id === 'T-101' && t.status === 'review'));
    await tool('request_merge', { task_id: 'T-101' });
    const first = (await until((e) => e.type === 'merge-request')) as Extract<WorkspaceEvent, { type: 'merge-request' }>;
    await svc.answerMerge(first.request.requestId, false);
    await until((e) => e.type === 'chat' && e.entry.kind === 'event' && /declined to merge T-101/.test(e.entry.text));

    await fs.writeFile(path.join(repo, 'dirty.txt'), 'x');
    events = [];
    await tool('request_merge', { task_id: 'T-101' });
    const second = (await until((e) => e.type === 'merge-request')) as Extract<WorkspaceEvent, { type: 'merge-request' }>;
    await svc.answerMerge(second.request.requestId, true);
    await until((e) => e.type === 'chat' && e.entry.kind === 'event' && /Merge of T-101: blocked/.test(e.entry.text));
    expect((await svc.snapshot()).tasks.find((t) => t.id === 'T-101')!.status).toBe('review');
  });

  it('merges straight away when auto-merge is on', async () => {
    const paths = dataPaths(data);
    const id = projectIdFor(repo);
    await fs.mkdir(paths.projectDir(id), { recursive: true });
    await fs.writeFile(paths.projectFile(id), JSON.stringify({ id, name: 'x', repoPath: repo, baseBranch: 'main', maxConcurrent: 4, bossCanHire: true, autoMerge: true }));
    await svc.open(repo);
    await tool('hire', { role_id: 'frontend' });
    await tool('assign_task', { agent: 'Pixel', title: 'Notes', brief: 'write notes' });
    await until((e) => e.type === 'tasks' && e.tasks.some((t) => t.id === 'T-101' && t.status === 'review'));
    expect(await tool('request_merge', { task_id: 'T-101' })).toMatchObject({ status: 'merged' });
  });
});
