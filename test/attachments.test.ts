import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectService } from '../src/main/workspace/projectService';
import { dataPaths } from '../src/main/store/paths';
import { makeRepo } from './helpers/repo';
import { FAKE_CLAUDE } from './helpers/runner';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
let repo: string; let data: string; let svc: ProjectService;
const fakeEnv: Record<string, string> = {};

beforeEach(async () => {
  repo = await makeRepo();
  data = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-att-'));
  for (const k of Object.keys(fakeEnv)) delete fakeEnv[k];
  fakeEnv.FAKE_CLAUDE_STDIN_OUT = path.join(data, 'stdin.jsonl');
  fakeEnv.FAKE_CLAUDE_ARGV_OUT = path.join(data, 'argv.jsonl');
  svc = new ProjectService({ paths: dataPaths(data), resourcesDir: path.resolve('resources'), claudeBin: process.execPath, claudeBinArgs: [FAKE_CLAUDE], claudeEnv: fakeEnv as NodeJS.ProcessEnv });
  await svc.init();
});
afterEach(async () => {
  await svc.close();
  await fs.rm(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  await fs.rm(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const stdin = async () => (await fs.readFile(fakeEnv.FAKE_CLAUDE_STDIN_OUT, 'utf8').catch(() => '')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
const until = async (pred: () => Promise<boolean>) => { for (let i = 0; i < 200; i++) { if (await pred()) return; await new Promise((r) => setTimeout(r, 50)); } throw new Error('timed out'); };

describe('chat attachments', () => {
  it('stores an image and a file, records them on the message and gives them to the boss', async () => {
    await svc.open(repo);
    await svc.sendToBoss('see these', [
      { name: '/Users/me/shot.png', mime: 'image/png', data: PNG },
      { name: 'notes.txt', mime: 'text/plain', data: new TextEncoder().encode('hello notes') },
    ]);
    const entry = (await svc.snapshot()).chat.find((e) => e.kind === 'user')!;
    expect(entry).toMatchObject({ text: 'see these', attachments: [
      { name: 'shot.png', mime: 'image/png', size: PNG.length, kind: 'image' },
      { name: 'notes.txt', mime: 'text/plain', size: 11, kind: 'file' },
    ] });
    await until(async () => (await stdin()).length > 0);
    const content = (await stdin())[0].message.content;
    expect(content[0].type).toBe('text');
    expect(content[0].text).toContain('see these');
    expect(content[0].text).toMatch(/Attached file: notes\.txt \(11 B\) at .*attachments/);
    expect(content[1]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/png' } });
    const argv = (await fs.readFile(fakeEnv.FAKE_CLAUDE_ARGV_OUT, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((l: { argv: string[] }) => l.argv.includes('mcp__agentoffice')).argv as string[];
    expect(argv[argv.indexOf('--add-dir') + 1]).toMatch(/attachments$/);
    const att = entry.kind === 'user' ? entry.attachments! : [];
    expect(await svc.readAttachment(att[0].id)).toMatch(/^data:image\/png;base64,/);
    await expect(svc.readAttachment(att[1].id)).rejects.toThrow(/image/);
  });

  it('sends a message that is only an image', async () => {
    await svc.open(repo);
    await svc.sendToBoss('', [{ name: 'a.png', mime: 'image/png', data: PNG }]);
    await until(async () => (await stdin()).length > 0);
    expect((await stdin())[0].message.content).toEqual([expect.objectContaining({ type: 'image' })]);
  });

  it('refuses junk and renamed files before storing anything', async () => {
    await svc.open(repo);
    await expect(svc.sendToBoss('x', [{ name: 'evil.png', mime: 'image/png', data: new TextEncoder().encode('not an image') }])).rejects.toThrow(/not a PNG/);
    await expect(svc.sendToBoss('x', 'nope')).rejects.toThrow();
    await expect(svc.sendToBoss('x', Array.from({ length: 6 }, () => ({ name: 'a.txt', mime: 'text/plain', data: new Uint8Array([1]) })))).rejects.toThrow(/5/);
    await expect(svc.sendToBoss('', [])).rejects.toThrow(/empty/);
    await expect(svc.readAttachment('../../settings')).rejects.toThrow();
    expect((await svc.snapshot()).chat.filter((e) => e.kind === 'user')).toHaveLength(0);
  });

  it('re-sends images after the boss restarts', async () => {
    fakeEnv.FAKE_CLAUDE_RESUME_FAIL = '1';
    await svc.open(repo);
    await svc.sendToBoss('first', []);
    await until(async () => (await stdin()).length > 0);
    await svc.close();
    await svc.open(repo); // resumes the saved session, which fails, so the last message is sent again to a fresh boss
    await svc.sendToBoss('look', [{ name: 'a.png', mime: 'image/png', data: PNG }]);
    await until(async () => (await stdin()).filter((l) => Array.isArray(l.message.content)).length >= 1);
    expect((await stdin()).filter((l) => Array.isArray(l.message.content)).at(-1).message.content.some((c: { type: string }) => c.type === 'image')).toBe(true);
  });
});
