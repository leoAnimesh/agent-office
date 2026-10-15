import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectService } from '../src/main/workspace/projectService';
import { BrowserService } from '../src/main/browser/browserService';
import { dataPaths } from '../src/main/store/paths';
import type { WorkspaceEvent } from '../src/shared/types';
import { makeRepo } from './helpers/repo';
import { FAKE_CLAUDE } from './helpers/runner';
import { addFixtureServer } from './fixtures/browser-repo';

let repo: string; let data: string; let svc: ProjectService; let events: WorkspaceEvent[];
const fakeEnv: Record<string, string> = {};
let canRun = false;

beforeEach(async () => {
  repo = await makeRepo();
  await addFixtureServer(repo);
  data = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-tb-'));
  for (const k of Object.keys(fakeEnv)) delete fakeEnv[k];
  fakeEnv.FAKE_CLAUDE_ARGV_OUT = path.join(data, 'argv.jsonl');
  svc = new ProjectService({ paths: dataPaths(data), resourcesDir: path.resolve('resources'), claudeBin: process.execPath, claudeBinArgs: [FAKE_CLAUDE], claudeEnv: fakeEnv as NodeJS.ProcessEnv });
  await svc.init();
  events = [];
  svc.on('event', (e) => events.push(e));
  const probe = new BrowserService(); canRun = await probe.available(); await probe.close();
}, 60_000);
afterEach(async () => {
  await svc.close();
  await fs.rm(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  await fs.rm(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const tool = (name: string, args: unknown = {}) => svc.tools().find((t) => t.name === name)!.run(args);
const until = async (pred: () => boolean | Promise<boolean>, ms = 30_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await pred()) return; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('timed out');
};
const launches = async () => (await fs.readFile(fakeEnv.FAKE_CLAUDE_ARGV_OUT, 'utf8').catch(() => '')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as { argv: string[] });

describe('team browser in a project', () => {
  it('lets an employee start a dev server and open it, then stops the server when the task ends', async ({ skip }) => {
    if (!canRun) skip();
    fakeEnv.FAKE_CLAUDE_MCP_CALLS = JSON.stringify([
      { tool: 'start_dev_server', args: { command: 'node server.mjs' } },
      { tool: 'browser_open', args: { url: '$URL' } },
    ]);
    await svc.open(repo);
    await tool('hire', { role_id: 'frontend' });
    const pixel = (await svc.snapshot()).agents.find((a) => a.name === 'Pixel')!;
    await tool('assign_task', { agent: 'Pixel', title: 'Check page', brief: 'look' });
    await until(async () => (await svc.snapshot()).tasks.some((t) => t.status === 'review'));
    const t = (await svc.snapshot()).tasks[0];
    expect(t.resultSummary).toContain('browser_open');
    expect(t.resultSummary).toContain('Fixture app');
    expect((await svc.previewList()).filter((r) => !r.device)).toEqual([expect.objectContaining({ agentId: pixel.id, title: 'Fixture app', devServer: null })]);
    const argv = (await launches()).find((l) => l.argv.includes('--permission-mode') && !l.argv.includes('mcp__agentoffice'))!.argv;
    expect(argv).toContain('--mcp-config');
    expect(argv.join(' ')).toContain('mcp__office');
    expect(events.some((e) => e.type === 'preview-changed')).toBe(true);
  }, 90_000);

  it('leaves the browser out when the project turns it off', async () => {
    await svc.open(repo);
    await svc.updateProject({ browserTools: false });
    await tool('hire', { role_id: 'frontend' });
    await tool('assign_task', { agent: 'Pixel', title: 'x', brief: 'x' });
    await until(async () => (await svc.snapshot()).tasks.some((t) => t.status === 'review'));
    const argv = (await launches()).find((l) => l.argv.includes('--permission-mode') && !l.argv.includes('mcp__agentoffice'))!.argv;
    expect(argv).not.toContain('--mcp-config');
  }, 60_000);
});
