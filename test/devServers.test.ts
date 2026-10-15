import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { DevServerService } from '../src/main/browser/devServers';

const FIXTURE = path.resolve('test/fixtures/dev-server.mjs');
const cmd = (extra = '') => `node "${FIXTURE}" ${extra}`.trim();
const answers = async (url: string) => { try { await fetch(url); return true; } catch { return false; } };

let svc: DevServerService;
beforeEach(() => { svc = new DevServerService({ cwdFor: () => process.cwd(), waitMs: 15_000 }); });
afterEach(async () => { await svc.stopAll(); });

describe('DevServerService', () => {
  it('starts a server on a free port and keeps its output', async () => {
    const { url, port } = await svc.start('a1', cmd());
    expect(url).toBe(`http://127.0.0.1:${port}/`);
    expect(await (await fetch(url)).text()).toContain('Fixture app');
    expect(svc.info('a1')).toMatchObject({ url, port, running: true });
    expect(svc.logs('a1')).toContain(`ready on ${port}`);
    expect(svc.logs('a1')).not.toContain('\u001b');
  });

  it('fills in {port} for servers that take a flag', async () => {
    const { url } = await svc.start('a1', cmd('--ignore-port --port {port}'));
    expect(await answers(url)).toBe(true);
  });

  it('reports a server that exits with its output', async () => {
    await expect(svc.start('a1', cmd('--die'))).rejects.toThrow(/boom: cannot start/);
    expect(svc.info('a1')).toBeNull();
  });

  it('times out on a server that ignores PORT and says why', async () => {
    const quick = new DevServerService({ cwdFor: () => process.cwd(), waitMs: 1500 });
    await expect(quick.start('a1', cmd('--ignore-port'))).rejects.toThrow(/\{port\}/);
    await quick.stopAll();
  });

  it('replaces an employee\'s old server and stops servers for good', async () => {
    const first = await svc.start('a1', cmd());
    const second = await svc.start('a1', cmd());
    expect(await answers(first.url)).toBe(false);
    expect(await answers(second.url)).toBe(true);
    const other = await svc.start('a2', cmd());
    expect(await svc.stop('a1')).toBe(true);
    expect(await svc.stop('a1')).toBe(false);
    expect(await answers(second.url)).toBe(false);
    await svc.stopAll();
    expect(await answers(other.url)).toBe(false);
    expect(svc.info('a2')).toBeNull();
  });

  it('refuses when the employee has no folder yet, or the command uses the shell', async () => {
    const none = new DevServerService({ cwdFor: () => undefined });
    await expect(none.start('a1', 'npm run dev')).rejects.toThrow(/no working folder/);
    await expect(svc.start('a1', 'npm i && npm run dev')).rejects.toThrow(/package script/);
  });
});
