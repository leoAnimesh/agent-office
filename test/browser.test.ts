import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { BrowserService, BrowserMissing, NO_BROWSER } from '../src/main/browser/browserService';

const PAGE = '<!doctype html><title>Fixture app</title><h1>Hello</h1><button onclick="document.querySelector(\'h1\').textContent=\'Clicked\'">Press me</button><input aria-label="Name"><script>console.error("fixture warning")</script>';
let server: http.Server;
let base = '';
let svc: BrowserService;
let canRun = false;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/away') { res.writeHead(302, { location: 'https://example.com/' }); return res.end(); }
    res.setHeader('content-type', 'text/html'); res.end(PAGE);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  svc = new BrowserService();
  canRun = await svc.available();
}, 60_000);
afterAll(async () => { await svc?.close(); server.close(); });

describe('BrowserService (real headless browser)', () => {
  it('opens a local page in an employee tab and acts on refs from a snapshot', async ({ skip }) => {
    if (!canRun) skip();
    const page = await svc.pageFor('a1');
    await page.goto(base);
    const snap = await page.ariaSnapshot({ mode: 'ai' });
    const ref = /button "Press me" \[ref=(e\d+)\]/.exec(snap)![1];
    await page.getByRef(ref).click();
    expect(await page.locator('h1').textContent()).toBe('Clicked');
    expect(svc.takeConsole('a1').join('\n')).toContain('fixture warning');
    expect(await svc.tabs()).toEqual([{ agentId: 'a1', url: base, title: 'Fixture app' }]);
  });

  it('keeps employees apart: separate storage', async ({ skip }) => {
    if (!canRun) skip();
    const a = await svc.pageFor('a1');
    const b = await svc.pageFor('a2');
    await a.goto(base); await b.goto(base);
    await a.evaluate(() => localStorage.setItem('k', 'from-a1'));
    expect(await b.evaluate(() => localStorage.getItem('k'))).toBeNull();
    await svc.closeFor('a2');
    expect(svc.has('a2')).toBe(false);
  });

  it('blocks navigation away from localhost', async ({ skip }) => {
    if (!canRun) skip();
    const page = await svc.pageFor('a1');
    const res = await page.goto(`${base}away`);
    expect(res?.status()).toBe(403);
    expect(await page.content()).toContain('Blocked');
    expect(page.url().startsWith('https://example.com')).toBe(false);
  });

  it('streams frames only for the watched tab and takes input', async ({ skip }) => {
    if (!canRun) skip();
    const frames: string[] = [];
    const watched = new BrowserService({ onFrame: (f) => { frames.push(f.agentId); watched.ack(); } });
    const page = await watched.pageFor('a1');
    await page.goto(base);
    await watched.watch('a1');
    await watched.input('a1', { kind: 'click', x: 0.02, y: 0.02, button: 'left' });
    await watched.input('a1', { kind: 'text', text: 'hi' });
    await new Promise((r) => setTimeout(r, 1000));
    expect(frames.length).toBeGreaterThan(0);
    expect(new Set(frames)).toEqual(new Set(['a1']));
    expect(watched.takeUserNote('a1')).toMatch(/user/i);
    expect(watched.takeUserNote('a1')).toBeUndefined();
    await watched.watch(null);
    await watched.close();
  });

  it('sends a first frame of an idle page as soon as it is watched', async ({ skip }) => {
    if (!canRun) skip();
    const frames: number[] = [];
    const idle = new BrowserService({ onFrame: (f) => { frames.push(f.width); idle.ack(); } });
    const page = await idle.pageFor('a1');
    await page.goto(base);
    await new Promise((r) => setTimeout(r, 1500)); // fully painted and still
    await idle.watch('a1');
    await expect.poll(() => frames.length, { timeout: 3000 }).toBeGreaterThan(0);
    await idle.close();
  });

  it('keeps streaming when the watched tab navigates to its first page', async ({ skip }) => {
    if (!canRun) skip();
    const frames: number[] = [];
    const early = new BrowserService({ onFrame: () => { frames.push(Date.now()); early.ack(); } });
    const page = await early.pageFor('a1');
    // Watching starts while the tab is still blank and the employee's page is loading (the race the Preview tab hits).
    await Promise.all([early.watch('a1'), page.goto(base)]);
    await new Promise((r) => setTimeout(r, 300));
    const after = Date.now();
    await page.evaluate(() => { document.body.style.background = 'rgb(200, 220, 255)'; });
    await expect.poll(() => frames.filter((t) => t >= after).length, { timeout: 3000 }).toBeGreaterThan(0);
    await early.close();
  });

  it('starts streaming a tab that is created after it was asked for', async ({ skip }) => {
    if (!canRun) skip();
    const frames: string[] = [];
    const later = new BrowserService({ onFrame: (f) => { frames.push(f.agentId); later.ack(); } });
    await later.watch('a1'); // the employee has a dev server but no tab yet
    const page = await later.pageFor('a1');
    await page.goto(base);
    await expect.poll(() => frames.length, { timeout: 3000 }).toBeGreaterThan(0);
    await later.close();
  });

  it('closes pop-up windows and notes them in the console', async ({ skip }) => {
    if (!canRun) skip();
    const svc2 = new BrowserService();
    const page = await svc2.pageFor('a1');
    await page.goto(base);
    await page.evaluate((u) => { window.open(u + '?popup'); }, base);
    await new Promise((r) => setTimeout(r, 800));
    expect(page.context().pages()).toHaveLength(1);
    expect(svc2.takeConsole('a1').join('\n')).toMatch(/pop-up/i);
    await svc2.close();
  });

  it('reports why a browser failed to start, not only that none was found', async () => {
    const broken = new BrowserService({ launch: async () => { throw new Error('Missing X server or $DISPLAY'); } });
    await expect(broken.pageFor('a1')).rejects.toThrow(/Missing X server/);
    await broken.close();
  });

  it('says how to get a browser when none can start', async () => {
    const none = new BrowserService({ launch: async () => { throw new BrowserMissing(); } });
    expect(await none.available()).toBe(false);
    await expect(none.pageFor('a1')).rejects.toBeInstanceOf(BrowserMissing);
    await expect(none.pageFor('a1')).rejects.toThrow(NO_BROWSER);
    await none.close();
  });
});
