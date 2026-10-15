import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { McpHost } from '../src/main/mcp/mcpHost';
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

  it('saves roles and skills after validating them', async () => {
    await svc.open(repo);
    const fe = (await svc.listRoles()).find((r) => r.id === 'frontend')!;
    await svc.saveRole({ ...fe, model: 'opus' });
    expect((await svc.listRoles()).find((r) => r.id === 'frontend')!.model).toBe('opus');
    await expect(svc.saveRole({ ...fe, id: '../evil' })).rejects.toThrow(/Invalid role/);
    const skill = await svc.saveSkill({ id: 'house-style', name: 'House style', description: 'How we write code', body: '- Use tabs.' });
    expect(skill.id).toBe('house-style');
    expect((await svc.listSkills()).map((s) => s.id)).toContain('house-style');
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
