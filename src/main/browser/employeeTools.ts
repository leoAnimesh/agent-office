import { z } from 'zod';
import type { ToolContext, ToolDef, ToolImage } from '../agents/bossTools';
import type { BrowserService } from './browserService';
import type { DevServerService } from './devServers';
import { LOCAL_ONLY, allowedUrl } from './rules';

export const AGENT_KEYS = ['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Space'] as const;
const MAX_SNAPSHOT = 40 * 1024;
const MAX_SHOT = 2 * 1024 * 1024;

/** An employee-only tool: the caller's id comes from its token. */
export function employeeTool<S extends z.ZodRawShape>(name: string, description: string, input: S, run: (args: z.infer<z.ZodObject<S>>, agentId: string) => Promise<unknown>): ToolDef {
  const schema = z.object(input);
  return {
    name, description, input,
    run: async (args: unknown, ctx?: ToolContext) => {
      if (!ctx?.agentId) throw new Error('These tools are only for employees');
      return run(schema.parse(args ?? {}), ctx.agentId);
    },
  };
}

/** Wraps Playwright's "ref not found" errors in an instruction the model can act on. */
const staleRef = (e: unknown): never => {
  const m = e instanceof Error ? e.message : String(e);
  if (/ref|resolve|not found|strict mode/i.test(m)) throw new Error('That ref is no longer on the page. Take a new browser_snapshot and use a ref from it.');
  throw e instanceof Error ? e : new Error(m);
};

export function employeeTools(d: { browser: BrowserService; devServers: DevServerService }): ToolDef[] {
  const { browser, devServers } = d;
  const withNote = async <T extends object>(agentId: string, value: T): Promise<T & { note?: string }> => {
    const note = browser.takeUserNote(agentId);
    return note ? { ...value, note } : value;
  };
  return [
    employeeTool('start_dev_server', 'Start the project\'s dev server in your folder on a free port (e.g. "npm run dev"; "{port}" in the command is replaced by the port). Returns the URL to open. No shell: use a package script for compound commands. It stops when your task ends.',
      { command: z.string().min(1).max(300) }, async ({ command }, agentId) => devServers.start(agentId, command)),
    employeeTool('dev_server_logs', 'Read the last lines of your dev server\'s output.', { lines: z.number().int().min(1).max(200).optional() },
      async ({ lines }, agentId) => devServers.logs(agentId, lines ?? 60)),
    employeeTool('stop_dev_server', 'Stop your dev server.', {}, async (_a, agentId) => ({ stopped: await devServers.stop(agentId) })),
    employeeTool('browser_open', 'Open a local URL (localhost / 127.0.0.1 only) in your private browser tab.', { url: z.string().min(1).max(2000) }, async ({ url }, agentId) => {
      const u = allowedUrl(url);
      if (!u) throw new Error(LOCAL_ONLY);
      const page = await browser.pageFor(agentId);
      const res = await page.goto(u.href, { timeout: 30_000 });
      return withNote(agentId, { url: page.url(), title: await page.title(), status: res?.status() ?? null });
    }),
    employeeTool('browser_snapshot', 'Read your tab as an accessibility outline. Elements have [ref=eN] ids to use with browser_click and browser_type. Refs change after every snapshot.', {}, async (_a, agentId) => {
      const page = await browser.pageFor(agentId);
      const snap = await page.ariaSnapshot({ mode: 'ai', timeout: 10_000 });
      const head = `Page: ${page.url()} — ${await page.title()}\n`;
      const note = browser.takeUserNote(agentId);
      const body = snap.length > MAX_SNAPSHOT ? `${snap.slice(0, MAX_SNAPSHOT)}\n… (cut at 40 KB)` : snap;
      return `${note ? `${note}\n` : ''}${head}${body}`;
    }),
    employeeTool('browser_click', 'Click an element by its ref from the latest browser_snapshot.', { ref: z.string().min(1).max(20), double: z.boolean().optional() }, async ({ ref, double }, agentId) => {
      const page = await browser.pageFor(agentId);
      await page.getByRef(ref).click({ timeout: 10_000, clickCount: double ? 2 : 1 }).catch(staleRef);
      return withNote(agentId, { ok: true, url: page.url(), title: await page.title() });
    }),
    employeeTool('browser_type', 'Fill a text field by its ref, optionally pressing Enter after.', { ref: z.string().min(1).max(20), text: z.string().max(5000), submit: z.boolean().optional() }, async ({ ref, text, submit }, agentId) => {
      const page = await browser.pageFor(agentId);
      await page.getByRef(ref).fill(text, { timeout: 10_000 }).catch(staleRef);
      if (submit) await page.keyboard.press('Enter');
      return withNote(agentId, { ok: true });
    }),
    employeeTool('browser_press', 'Press a key in your tab.', { key: z.enum(AGENT_KEYS) }, async ({ key }, agentId) => {
      const page = await browser.pageFor(agentId);
      await page.keyboard.press(key === 'Space' ? ' ' : key);
      return withNote(agentId, { ok: true });
    }),
    employeeTool('browser_screenshot', 'Take a screenshot of your tab (the visible part, or the full page).', { full_page: z.boolean().optional() }, async ({ full_page }, agentId) => {
      const page = await browser.pageFor(agentId);
      let buf = await page.screenshot({ type: 'png', fullPage: full_page ?? false, timeout: 10_000 });
      let mimeType = 'image/png';
      if (buf.length > MAX_SHOT) { buf = await page.screenshot({ type: 'jpeg', quality: 70, fullPage: full_page ?? false }); mimeType = 'image/jpeg'; }
      const image: ToolImage = { type: 'image', data: buf.toString('base64'), mimeType, note: browser.takeUserNote(agentId) };
      return image;
    }),
    employeeTool('browser_console', 'Console errors and warnings, page errors and failed requests since you last asked.', {}, async (_a, agentId) => {
      if (!browser.has(agentId)) return 'You have no browser tab yet. Use browser_open first.';
      const lines = browser.takeConsole(agentId);
      return lines.length > 0 ? lines.join('\n') : 'Nothing new.';
    }),
    employeeTool('browser_resize', 'Resize your tab to check other screen sizes (e.g. 390x844 for a phone).', { width: z.number().int().min(320).max(2560), height: z.number().int().min(320).max(1600) }, async ({ width, height }, agentId) => {
      const page = await browser.pageFor(agentId);
      await page.setViewportSize({ width, height });
      return withNote(agentId, { ok: true });
    }),
  ];
}
