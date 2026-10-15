import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { McpHost } from '../src/main/mcp/mcpHost';
import { BossSession } from '../src/main/boss/bossSession';
import { projectIdFor } from '../src/main/workspace/projectService';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectService, isInside } from '../src/main/workspace/projectService';
import { dataPaths } from '../src/main/store/paths';
import type { WorkspaceEvent } from '../src/shared/types';
import { makeRepo } from './helpers/repo';
import { FAKE_CLAUDE } from './helpers/runner';

let repo: string;
let data: string;
let svc: ProjectService;
let events: WorkspaceEvent[];
const fakeEnv: Record<string, string> = { FAKE_CLAUDE_FILE: 'notes.txt' };

beforeEach(async () => {
  repo = await makeRepo();
  data = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-svcui-'));
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
  const timer = setTimeout(() => reject(new Error('timed out')), ms);
  svc.on('event', function l(e: WorkspaceEvent) { if (pred(e)) { clearTimeout(timer); svc.off('event', l); resolve(e); } });
});

describe('ProjectService (UI features)', () => {
  it('applies open options to a new project and its boss', async () => {
    const snap = await svc.open(repo, { bossName: 'Ada', bossModel: 'sonnet' });
    expect(snap.agents.find((a) => a.kind === 'boss')!.name).toBe('Ada');
    expect((await svc.listRoles()).find((r) => r.id === 'boss')!.model).toBe('sonnet');
  });

  it('applies the boss model only when the project is new', async () => {
    await svc.open(repo, { bossModel: 'sonnet' });
    await svc.close();
    await svc.open(repo, { bossModel: 'haiku' });
    expect((await svc.listRoles()).find((r) => r.id === 'boss')!.model).toBe('sonnet');
  });

  it('creates a brand-new project, opens it and hands the brief to the boss', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-newp-'));
    const snap = await svc.create({ parentDir: parent, name: 'Recipe App', brief: 'Build a recipe list app.', bossName: 'Ada' });
    expect(snap.project).toMatchObject({ name: 'Recipe App', repoPath: path.join(await fs.realpath(parent), 'Recipe App'), baseBranch: 'main' });
    expect(snap.agents.find((a) => a.kind === 'boss')!.name).toBe('Ada');
    expect(snap.chat[0]).toMatchObject({ kind: 'user', text: 'Build a recipe list app.' });
    await svc.close();
    await fs.rm(parent, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  it('updates project settings with validation and emits the change', async () => {
    await svc.open(repo);
    expect(await svc.updateProject({ maxConcurrent: 2, autoMerge: true })).toMatchObject({ maxConcurrent: 2, autoMerge: true });
    expect(events.some((e) => e.type === 'project' && e.project.maxConcurrent === 2)).toBe(true);
    await expect(svc.updateProject({ maxConcurrent: 99 })).rejects.toThrow(/maxConcurrent/);
    expect((await svc.snapshot()).project.maxConcurrent).toBe(2);
  });

  it('lists roles and skills for the screens (they are changed only through the boss)', async () => {
    await svc.open(repo);
    expect((await svc.listRoles()).map((r) => r.id)).toContain('frontend');
    expect((await svc.listSkills()).map((s) => s.id)).toContain('git-hygiene');
    expect('saveRole' in svc).toBe(false);
  });

  it('streams agent events with timestamps, serves their log, and guards worktree paths', async () => {
    await svc.open(repo);
    const pixel = await svc.hire('frontend');
    await svc.tools().find((t) => t.name === 'assign_task')!.run({ agent: 'Pixel', title: 'Notes', brief: 'write notes' });
    const ev = await until((e) => e.type === 'agent-event');
    expect(ev).toMatchObject({ agentId: pixel.id, at: expect.stringMatching(/^\d{4}-/) });
    await until((e) => e.type === 'tasks' && e.tasks.some((t) => t.status === 'review'));
    const log = await svc.agentLog(pixel.id);
    expect(log.map((l) => l.event.type)).toContain('result');
    expect(svc.worktreeFor(pixel.id)).toBe(path.join(repo, '.agentoffice', 'wt', 'pixel'));
    const boss = (await svc.snapshot()).agents.find((a) => a.kind === 'boss')!;
    expect(() => svc.worktreeFor(boss.id)).toThrow(/no worktree/);
  });

  it('cleans up the MCP server when opening fails part-way', async () => {
    const paths = dataPaths(data);
    await fs.mkdir(path.join(paths.projectDir(projectIdFor(repo)), 'mcp.json'), { recursive: true });
    const close = vi.spyOn(McpHost.prototype, 'close');
    await expect(svc.open(repo)).rejects.toThrow();
    expect(close).toHaveBeenCalled();
    expect(svc.current()).toBeNull();
    close.mockRestore();
  });

  it('isInside only accepts real children', () => {
    expect(isInside(path.join('/a', 'b', 'c'), path.join('/a', 'b'))).toBe(true);
    expect(isInside(path.join('/a', 'b'), path.join('/a', 'b'))).toBe(false);
    expect(isInside(path.join('/a', 'bc'), path.join('/a', 'b'))).toBe(false);
    expect(isInside(path.join('/a', 'b', '..', 'x'), path.join('/a', 'b'))).toBe(false);
  });
});

describe('ProjectService terminal', () => {
  const waitOut = async (out: () => string, text: string) => {
    const end = Date.now() + 15000;
    while (!out().includes(text)) {
      if (Date.now() > end) throw new Error(`no "${text}" in terminal output:\n${out()}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  };

  it('runs a shell in the open project folder and ends it when the project closes', async () => {
    let out = '';
    svc.on('terminal', (e: { type: string; data?: string }) => { if (e.type === 'data') out += e.data; });
    await expect(svc.terminalOpen(80, 24)).rejects.toThrow(/Open a project first/);
    await svc.open(repo);
    await svc.terminalOpen(100, 30);
    svc.terminalWrite('echo ao-svc-term\r');
    await waitOut(() => out, 'ao-svc-term');
    svc.terminalWrite('pwd\r');
    await waitOut(() => out, path.basename(repo));
    await svc.close();
    expect(svc.terminalSessions()).toBe(0);
  });
});

describe('roles changed from chat', () => {
  it('tells the renderer so it reloads the role list', async () => {
    await svc.open(repo);
    await svc.tools().find((t) => t.name === 'create_role')!.run({ name: 'Data Engineer', description: 'Pipelines', system_prompt: 'Build pipelines.' });
    expect(events).toContainEqual({ type: 'roles-changed' });
    expect((await svc.listRoles()).map((r) => r.id)).toContain('data-engineer');
  });
});

describe('history', () => {
  it('reads the open project\'s git history, read-only', async () => {
    await expect(svc.historyBranches()).rejects.toThrow(/No project is open/);
    await svc.open(repo);
    expect(await svc.historyBranches()).toEqual(['main']);
    const [first] = await svc.historyList('main', 0, false);
    expect(first).toMatchObject({ subject: 'init', files: 1 });
    expect(await svc.historyCommit(first.sha)).toMatchObject({ subject: 'init', files: [{ path: 'README.md', add: 1, del: 0 }] });
    expect(await svc.historyDiff(first.sha, 'README.md')).toContain('+hello');
    await expect(svc.historyList('--all', 0, false)).rejects.toThrow(/Unknown branch/);
  });
});

describe('project skills edited by the user', () => {
  it('lets the user add and remove project skills, and tells the boss', async () => {
    await svc.open(repo);
    const notify = vi.spyOn(BossSession.prototype, 'notify').mockResolvedValue(undefined);
    const snap = await svc.setProjectSkills({ add: ['docker', 'vue'] });
    expect(snap.project.skills).toEqual([
      { id: 'docker', reason: 'Added by you', addedBy: 'user' },
      { id: 'vue', reason: 'Added by you', addedBy: 'user' },
    ]);
    const after = await svc.setProjectSkills({ remove: ['vue'] });
    expect(after.project).toMatchObject({ skillsExcluded: ['vue'] });
    expect(events.some((e) => e.type === 'project' && e.project.skills?.length === 1)).toBe(true);
    expect(notify).toHaveBeenLastCalledWith('The user changed the project skills: −vue. Respect these; you cannot re-add skills the user removed.');
    notify.mockRestore();
  });

  it('refuses bad project skill edits before changing anything', async () => {
    await svc.open(repo);
    await expect(svc.setProjectSkills({ add: 'docker' })).rejects.toThrow();
    await expect(svc.setProjectSkills({ add: ['../etc'] })).rejects.toThrow();
    await expect(svc.setProjectSkills({ add: Array.from({ length: 23 }, (_, i) => `s${i}`) })).rejects.toThrow();
    await expect(svc.setProjectSkills({ add: ['no-such-skill'] })).rejects.toThrow(/Unknown skills/);
    expect((await svc.snapshot()).project.skills).toBeUndefined();
  });
});
