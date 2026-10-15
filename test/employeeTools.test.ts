import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { BrowserService } from '../src/main/browser/browserService';
import { DevServerService } from '../src/main/browser/devServers';
import { employeeTools } from '../src/main/browser/employeeTools';
import type { ToolDef } from '../src/main/agents/bossTools';

const FIXTURE = path.resolve('test/fixtures/dev-server.mjs');
let browser: BrowserService;
let devServers: DevServerService;
let tools: ToolDef[];
let canRun = false;
const call = (name: string, args: unknown, agentId = 'a1') => tools.find((t) => t.name === name)!.run(args, { agentId });

beforeAll(async () => {
  browser = new BrowserService();
  devServers = new DevServerService({ cwdFor: () => process.cwd(), waitMs: 15_000 });
  tools = employeeTools({ browser, devServers });
  canRun = await browser.available();
}, 60_000);
afterAll(async () => { await devServers.stopAll(); await browser.close(); });

describe('employee tools', () => {
  it('exposes the documented tools', () => {
    expect(tools.map((t) => t.name).sort()).toEqual(['browser_click', 'browser_console', 'browser_open', 'browser_press', 'browser_resize', 'browser_screenshot', 'browser_snapshot', 'browser_type', 'dev_server_logs', 'start_dev_server', 'stop_dev_server']);
  });

  it('refuses calls without a caller and URLs that are not local', async () => {
    await expect(tools.find((t) => t.name === 'stop_dev_server')!.run({}, {})).rejects.toThrow(/employee/);
    await expect(call('browser_open', { url: 'https://example.com' })).rejects.toThrow(/Only local addresses/);
  });

  it('runs a dev server, opens it, reads, clicks, types and screenshots', async ({ skip }) => {
    if (!canRun) skip();
    const { url } = (await call('start_dev_server', { command: `node "${FIXTURE}"` })) as { url: string };
    expect(await call('browser_open', { url })).toMatchObject({ title: 'Fixture app', status: 200 });
    const snap = String(await call('browser_snapshot', {}));
    const ref = /button "Press me" \[ref=(e\d+)\]/.exec(snap)![1];
    expect(await call('browser_click', { ref })).toMatchObject({ ok: true });
    expect(String(await call('browser_snapshot', {}))).toContain('heading "Clicked"');
    const box = /textbox "Name" \[ref=(e\d+)\]/.exec(String(await call('browser_snapshot', {})))![1];
    expect(await call('browser_type', { ref: box, text: 'Ada', submit: true })).toMatchObject({ ok: true });
    const shot = (await call('browser_screenshot', {})) as { type: string; mimeType: string; data: string };
    expect(shot).toMatchObject({ type: 'image', mimeType: 'image/png' });
    expect(Buffer.from(shot.data, 'base64').subarray(1, 4).toString()).toBe('PNG');
    expect(String(await call('browser_console', {}))).toContain('fixture warning');
    expect(await call('browser_resize', { width: 390, height: 844 })).toMatchObject({ ok: true });
    expect(String(await call('dev_server_logs', { lines: 5 }))).toContain('ready on');
    expect(await call('stop_dev_server', {})).toEqual({ stopped: true });
  });

  it('says to open a page first when there is no tab yet', async () => {
    expect(String(await call('browser_console', {}, 'nobody-yet'))).toMatch(/browser_open/);
  });

  it('asks for a fresh snapshot when a ref is stale', async ({ skip }) => {
    if (!canRun) skip();
    await expect(call('browser_click', { ref: 'e999' })).rejects.toThrow(/browser_snapshot/);
  });

  it('keeps employees to their own tab', async ({ skip }) => {
    if (!canRun) skip();
    await call('browser_resize', { width: 500, height: 500 }, 'a2');
    expect(browser.has('a2')).toBe(true);
    const a1 = await browser.pageFor('a1');
    expect(a1.viewportSize()).toEqual({ width: 390, height: 844 });
  });
});
