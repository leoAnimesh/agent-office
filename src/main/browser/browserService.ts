import { existsSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright-core';
import type { PreviewFrame as Frame, PreviewInput } from '../../shared/types';
import { allowedUrl } from './rules';

export type { Frame, PreviewInput };

export const NO_BROWSER = 'No browser found. Install Google Chrome or Microsoft Edge, then try again.';
export class BrowserMissing extends Error { constructor() { super(NO_BROWSER); } }

export interface TabInfo { agentId: string; url: string; title: string }

interface Tab { context: BrowserContext; page: Page; console: string[]; userAt: number; userNote: boolean }

const VIEWPORT = { width: 1280, height: 800 };
const CONSOLE_KEEP = 50;
const USER_QUIET_MS = 30_000;

/** The user's Chrome, then Edge, then Playwright's own Chromium if it is installed (dev machines and CI). */
async function launchDefault(): Promise<Browser> {
  for (const channel of ['chrome', 'msedge']) {
    try { return await chromium.launch({ channel, headless: true }); } catch { /* try the next one */ }
  }
  const bundled = chromium.executablePath();
  if (bundled && existsSync(bundled)) return chromium.launch({ headless: true });
  throw new BrowserMissing();
}

/** One headless browser per project, a private tab per employee, and a live view of one tab for the Preview tab. */
export class BrowserService {
  private browser: Promise<Browser> | null = null;
  private tabsById = new Map<string, Tab>();
  private creating = new Map<string, Promise<Tab>>();
  private cast: { agentId: string; cdp: CDPSession } | null = null;
  private inFlight = false;
  private closed = false;

  constructor(private readonly opts: { launch?: () => Promise<Browser>; onChange?(): void; onFrame?(f: Frame): void } = {}) {}

  async available(): Promise<boolean> {
    try { await this.ensureBrowser(); return true; } catch { return false; }
  }

  private ensureBrowser(): Promise<Browser> {
    if (this.closed) return Promise.reject(new Error('The project is closed'));
    if (!this.browser) {
      this.browser = (this.opts.launch ?? launchDefault)().catch((e) => {
        this.browser = null;
        throw e instanceof BrowserMissing ? e : new BrowserMissing();
      });
    }
    return this.browser;
  }

  has(agentId: string): boolean { return this.tabsById.has(agentId); }

  async pageFor(agentId: string): Promise<Page> {
    const existing = this.tabsById.get(agentId);
    if (existing && !existing.page.isClosed()) return existing.page;
    if (!this.creating.has(agentId)) {
      this.creating.set(agentId, this.makeTab(agentId, existing).finally(() => this.creating.delete(agentId)));
    }
    return (await this.creating.get(agentId)!).page;
  }

  private async makeTab(agentId: string, old: Tab | undefined): Promise<Tab> {
    const browser = await this.ensureBrowser();
    const context = old?.context ?? await browser.newContext({ viewport: VIEWPORT });
    if (!old) {
      // Only local pages: block any navigation (top level or frames) to another host. Fonts, scripts and images
      // from elsewhere still load, so real apps render.
      await context.route('**/*', async (route) => {
        const req = route.request();
        if (!req.isNavigationRequest()) return route.continue();
        if (!allowedUrl(req.url())) return route.abort('blockedbyclient');
        // Fetch page loads ourselves without following redirects: the browser would follow a 302 to another
        // site without asking the route again.
        const res = await route.fetch({ maxRedirects: 0 }).catch(() => null);
        if (!res) return route.abort('connectionrefused');
        const location = res.headers().location;
        if (res.status() >= 300 && res.status() < 400 && location && !allowedUrl(new URL(location, req.url()).href)) {
          return route.fulfill({ status: 403, contentType: 'text/plain', body: 'Blocked: this page redirects outside localhost.' });
        }
        return route.fulfill({ response: res });
      });
    }
    const page = await context.newPage();
    const tab: Tab = { context, page, console: old?.console ?? [], userAt: 0, userNote: false };
    const keep = (line: string) => { tab.console.push(line); if (tab.console.length > CONSOLE_KEEP) tab.console.shift(); };
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') keep(`${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => keep(`page error: ${e.message}`));
    page.on('requestfailed', (r) => keep(`request failed: ${r.method()} ${r.url()} (${r.failure()?.errorText ?? 'failed'})`));
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) this.opts.onChange?.(); });
    this.tabsById.set(agentId, tab);
    this.opts.onChange?.();
    return tab;
  }

  async tabs(): Promise<TabInfo[]> {
    const out: TabInfo[] = [];
    for (const [agentId, t] of this.tabsById) {
      if (t.page.isClosed()) continue;
      out.push({ agentId, url: t.page.url(), title: await t.page.title().catch(() => '') });
    }
    return out;
  }

  /** Console errors and failed requests since the last call. */
  takeConsole(agentId: string): string[] {
    const t = this.tabsById.get(agentId);
    if (!t) return [];
    return t.console.splice(0, t.console.length);
  }

  /** Set once after the user starts using the employee's tab; read (and cleared) by the next browser tool result. */
  takeUserNote(agentId: string): string | undefined {
    const t = this.tabsById.get(agentId);
    if (!t?.userNote) return undefined;
    t.userNote = false;
    return 'The user used your browser tab since your last action; check its state before continuing.';
  }

  async closeFor(agentId: string): Promise<void> {
    const t = this.tabsById.get(agentId);
    if (!t) return;
    if (this.cast?.agentId === agentId) await this.watch(null);
    this.tabsById.delete(agentId);
    await t.context.close().catch(() => undefined);
    this.opts.onChange?.();
  }

  /** Stream one tab to the Preview tab (null stops). */
  async watch(agentId: string | null): Promise<void> {
    if (this.cast) {
      const old = this.cast;
      this.cast = null;
      await old.cdp.send('Page.stopScreencast').catch(() => undefined);
      await old.cdp.detach().catch(() => undefined);
    }
    this.inFlight = false;
    if (!agentId) return;
    const t = this.tabsById.get(agentId);
    if (!t || t.page.isClosed()) return;
    const cdp = await t.context.newCDPSession(t.page);
    cdp.on('Page.screencastFrame', (f: { data: string; sessionId: number; metadata: { deviceWidth: number; deviceHeight: number } }) => {
      void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => undefined);
      if (this.inFlight || this.cast?.cdp !== cdp) return;
      this.inFlight = true;
      this.opts.onFrame?.({ agentId, data: f.data, width: Math.round(f.metadata.deviceWidth), height: Math.round(f.metadata.deviceHeight) });
    });
    this.cast = { agentId, cdp };
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: 1280, maxHeight: 800 });
  }

  /** The renderer drew the last frame; the next one may be sent. */
  ack(): void { this.inFlight = false; }

  async input(agentId: string, e: PreviewInput): Promise<void> {
    const t = this.tabsById.get(agentId);
    if (!t || t.page.isClosed()) throw new Error('That tab is closed');
    const now = Date.now();
    if (now - t.userAt > USER_QUIET_MS) t.userNote = true;
    t.userAt = now;
    const vp = t.page.viewportSize() ?? VIEWPORT;
    const at = (x: number, y: number) => [Math.round(x * vp.width), Math.round(y * vp.height)] as const;
    if (e.kind === 'click') { const [x, y] = at(e.x, e.y); await t.page.mouse.click(x, y, { button: e.button }); }
    else if (e.kind === 'wheel') { const [x, y] = at(e.x, e.y); await t.page.mouse.move(x, y); await t.page.mouse.wheel(0, e.dy); }
    else if (e.kind === 'key') await t.page.keyboard.press(e.key);
    else await t.page.keyboard.insertText(e.text);
  }

  async reload(agentId: string): Promise<void> {
    const t = this.tabsById.get(agentId);
    if (t && !t.page.isClosed()) await t.page.reload({ timeout: 30_000 }).catch(() => undefined);
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.watch(null);
    const b = this.browser;
    this.browser = null;
    this.tabsById.clear();
    if (b) await (await b.catch(() => null))?.close().catch(() => undefined);
  }
}
