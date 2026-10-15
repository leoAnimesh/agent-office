# Team Browser and Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Employees get a private browser tab and an app-run dev server to check their own UI work, and the user watches and drives any employee's tab live from a new Preview tab.

**Architecture:** Per open project, the main process owns one headless Chromium (`BrowserService`, via `playwright-core`), one dev server per employee (`DevServerService`), and a second MCP server named `office` whose per-employee bearer tokens tell each tool call which employee is calling. Employees launch with that server in their `--mcp-config`. The renderer gets screencast frames on a dedicated IPC channel and sends validated input back.

**Tech Stack:** TypeScript, Electron, `playwright-core` 1.64.0, `@modelcontextprotocol/sdk`, React, zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-15-team-browser-design.md`

**Rulings against the spec (made while planning, apply throughout):**
- **No in-app Chromium download.** Playwright's installer forks a helper Node process; packaged builds turn off `runAsNode` (Electron fuse), so it cannot run there. Instead: try the user's Chrome, then Edge, then Playwright's own Chromium if it is already installed (dev machines and CI). When none launches, tools and the Preview tab say "No browser found. Install Google Chrome or Microsoft Edge, then try again." with a link to `https://www.google.com/chrome/`. The `browser:download` channel and download events are dropped.
- **"Open in my browser"** uses the existing `openExternal` IPC (already restricted to http/https) with the tab's URL; no new channel.
- **"The user is using your tab"** reaches the employee as a `note` field on its next browser tool result (not an agent-log line), since the employee only reads tool results.
- **Frame back-pressure** uses a `preview:ack` call from the renderer after it has drawn a frame.

## Global Constraints

- `playwright-core` is a runtime dependency pinned exactly: `"playwright-core": "1.64.0"` (same version as `@playwright/test`).
- Only `http:`/`https:` URLs whose host is exactly `localhost`, `127.0.0.1` or `[::1]` may be opened or navigated to by top-level/frames navigation. Sub-resources from other hosts load normally.
- Dev server commands: no shell; refused operators `&&`, `||`, `|`, `;`, `<`, `>`, backtick, `$(`. `{port}` is replaced by the chosen port. Wait up to 90 s for the port to answer; keep 200 output lines (ANSI stripped); errors show the last 40.
- Env for dev servers: `PORT=<port>`, `HOST=127.0.0.1`, `BROWSER=none`, `CI=1`.
- Tool limits: `command` ≤ 300 chars; `text` ≤ 5,000; `lines` 1–200 (default 60); resize width 320–2560, height 320–1600; snapshot ≤ 40 KB (cut with a note); screenshot ≤ 2 MB PNG else JPEG q70; navigation timeout 30 s, actions 10 s; console buffer last 50 entries.
- Preview input: `x`,`y` in [0,1]; text ≤ 1,000; keys from `PREVIEW_KEYS`. Screencast JPEG q70, max 1280×800, at most one frame in flight to the renderer.
- Tabs: one `BrowserContext` (in-memory profile, viewport 1280×800) + one `Page` per employee.
- Employee MCP server name `office`; employees add `mcp__office` to `--allowedTools`; config file `projects/<id>/mcp-<agentId>.json`, mode 0600.
- `Project.browserTools` (undefined = on).
- All IPC handlers use `handle()` (sender guard) and validate arguments.
- Cross-platform: `cross-spawn`, `detached` on POSIX, `killTree` to stop, `node:path`, tests must pass on Windows.
- Commits: Conventional Commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Gates: `npm run typecheck && npm test && npm run test:e2e`.

## Review Focus

1. A dev server that keeps running after its task ends, its employee is fired, or the project closes (orphaned `node` processes holding ports). Pinned in Task 3 (`stop`/`stopAll` leave no process) and Task 6 (stopped when the task goes to review).
2. A page that redirects to an external site after `browser_open` of a local URL must be blocked, not followed. Pinned in Task 4 (`blocks navigation away from localhost`).
3. Two employees' tabs must not share cookies or storage. Pinned in Task 4.
4. A forged or revoked token on the `office` server must be refused (401), and one employee's token must never reach another's tab. Pinned in Task 2 and Task 5.
5. No browser on the machine: every browser tool returns the install message instead of hanging or crashing, and the Preview tab shows it. Pinned in Task 4 (`BrowserMissing` with an injected failing launcher) and Task 8 (empty state helper).

---

### Task 1: Pure rules (URL, command splitting, ports, ANSI)

**Files:**
- Create: `src/main/browser/rules.ts`
- Test: `src/main/browser/rules.test.ts`

**Interfaces:**
- Produces:
  - `allowedUrl(raw: string): URL | null`
  - `splitCommand(command: string, port: number): string[]` (throws `Error` with a user-facing message)
  - `freePort(): Promise<number>`
  - `stripAnsi(s: string): string`
  - `LOCAL_ONLY = 'Only local addresses (localhost / 127.0.0.1) can be opened'`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import net from 'node:net';
import { allowedUrl, freePort, splitCommand, stripAnsi } from './rules';

describe('allowedUrl', () => {
  it('allows only http(s) on localhost, 127.0.0.1 and [::1]', () => {
    for (const ok of ['http://localhost:5173/', 'https://127.0.0.1/x?y=1', 'http://[::1]:3000/a']) expect(allowedUrl(ok)?.href, ok).toBeTruthy();
    for (const bad of ['https://example.com', 'http://localhost.evil.com', 'file:///etc/passwd', 'javascript:alert(1)', 'http://10.0.0.1', 'http://0.0.0.0:3000', 'not a url', 'ws://localhost:1'])
      expect(allowedUrl(bad), bad).toBeNull();
  });
});

describe('splitCommand', () => {
  it('splits on spaces, keeps quoted parts and fills in {port}', () => {
    expect(splitCommand('npm run dev', 5174)).toEqual(['npm', 'run', 'dev']);
    expect(splitCommand('npm run dev -- --port {port}', 5174)).toEqual(['npm', 'run', 'dev', '--', '--port', '5174']);
    expect(splitCommand(`node -e "console.log('a b')"`, 1)).toEqual(['node', '-e', "console.log('a b')"]);
    expect(splitCommand("echo 'x && y'", 1)).toEqual(['echo', 'x && y']);
  });

  it('refuses shell operators outside quotes, and empty commands', () => {
    for (const bad of ['npm i && npm run dev', 'a | b', 'a; b', 'a > f', 'a < f', 'echo `id`', 'echo $(id)', 'a || b'])
      expect(() => splitCommand(bad, 1), bad).toThrow(/package script/);
    expect(() => splitCommand('   ', 1)).toThrow(/command/);
    expect(() => splitCommand('echo "unterminated', 1)).toThrow(/quote/);
  });
});

describe('freePort', () => {
  it('returns a port that can be bound on 127.0.0.1', async () => {
    const port = await freePort();
    const srv = net.createServer();
    await new Promise<void>((resolve, reject) => { srv.once('error', reject); srv.listen(port, '127.0.0.1', () => resolve()); });
    srv.close();
  });
});

describe('stripAnsi', () => {
  it('removes colour codes', () => {
    expect(stripAnsi('\u001b[32mready\u001b[39m in 300 ms')).toBe('ready in 300 ms');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/main/browser/rules.test.ts`
Expected: FAIL — cannot resolve `./rules`.

- [ ] **Step 3: Implement**

```ts
import net from 'node:net';

export const LOCAL_ONLY = 'Only local addresses (localhost / 127.0.0.1) can be opened';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Employees may only open their own local app: http(s) on the loopback names, nothing else. */
export function allowedUrl(raw: string): URL | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return LOCAL_HOSTS.has(u.hostname) ? u : null;
}

/**
 * Splits a dev server command into argv without a shell. Quotes group words; shell operators outside quotes are
 * refused, because there is no shell to run them. `{port}` becomes the chosen port.
 */
export function splitCommand(command: string, port: number): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let started = false;
  const s = command.trim();
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null; else cur += c;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; started = true; continue; }
    if (/\s/.test(c)) { if (started) { out.push(cur); cur = ''; started = false; } continue; }
    if ('|;<>`&'.includes(c) || (c === '$' && s[i + 1] === '(')) {
      throw new Error('Shell operators are not supported here. Use a package script for compound commands (e.g. npm run dev).');
    }
    cur += c; started = true;
  }
  if (quote) throw new Error('The command has an unclosed quote');
  if (started) out.push(cur);
  if (out.length === 0) throw new Error('Give the command that starts the dev server, e.g. npm run dev');
  return out.map((a) => a.split('{port}').join(String(port)));
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

// eslint-disable-next-line no-control-regex
export const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
```

- [ ] **Step 4: Run it**

Run: `npx vitest run src/main/browser/rules.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/browser/rules.ts src/main/browser/rules.test.ts
git commit -m "feat(browser): local-only URL rule and shell-free command splitting"
```

---

### Task 2: McpHost: per-client tokens, caller context, image results

**Files:**
- Modify: `src/main/mcp/mcpHost.ts`
- Modify: `src/main/agents/bossTools.ts` (`ToolDef.run` signature, `ToolContext`, `ToolImage`)
- Test: `test/mcpHost.test.ts`

**Interfaces:**
- Produces (in `bossTools.ts`, next to `ToolDef`):
  - `interface ToolContext { agentId?: string }`
  - `ToolDef.run(args: unknown, ctx?: ToolContext): Promise<unknown>`
  - `interface ToolImage { type: 'image'; data: string; mimeType: string; note?: string }` and `isToolImage(v: unknown): v is ToolImage`
- Produces (in `McpHost`): `addClient(agentId: string): string` (returns a new token, replacing that agent's old one), `removeClient(agentId: string): void`, `writeClientConfig(agentId: string, token: string, file: string): Promise<void>`.

- [ ] **Step 1: Write the failing tests** (append to `test/mcpHost.test.ts`)

```ts
describe('McpHost clients', () => {
  const whoTools: ToolDef[] = [
    { name: 'whoami', description: 'Say which agent is calling', input: {}, run: async (_a, ctx) => ({ agent: ctx?.agentId ?? null }) },
    { name: 'pic', description: 'Return a tiny image', input: {}, run: async () => ({ type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png', note: 'tiny' }) },
  ];
  let h: McpHost;
  beforeEach(async () => { h = new McpHost(whoTools, 'office'); await h.start(); });
  afterEach(async () => { await h.close(); });
  const connectTo = async (token: string) => {
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(h.url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    return client;
  };

  it('tells tools which agent is calling, from its own token', async () => {
    const a = await connectTo(h.addClient('agent-a'));
    const b = await connectTo(h.addClient('agent-b'));
    expect(JSON.parse(((await a.callTool({ name: 'whoami', arguments: {} })).content as { text: string }[])[0].text)).toEqual({ agent: 'agent-a' });
    expect(JSON.parse(((await b.callTool({ name: 'whoami', arguments: {} })).content as { text: string }[])[0].text)).toEqual({ agent: 'agent-b' });
    await a.close(); await b.close();
  });

  it('refuses revoked and replaced tokens', async () => {
    const old = h.addClient('agent-a');
    const fresh = h.addClient('agent-a');
    await expect(connectTo(old)).rejects.toThrow();
    h.removeClient('agent-a');
    await expect(connectTo(fresh)).rejects.toThrow();
  });

  it('returns image results as MCP image content', async () => {
    const c = await connectTo(h.addClient('agent-a'));
    const r = await c.callTool({ name: 'pic', arguments: {} });
    expect(r.content).toEqual([{ type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' }, { type: 'text', text: 'tiny' }]);
    await c.close();
  });

  it('writes a private per-client config', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-mcpc-'));
    const token = h.addClient('agent-a');
    const file = path.join(dir, 'mcp-agent-a.json');
    await h.writeClientConfig('agent-a', token, file);
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ mcpServers: { office: { type: 'http', url: h.url, headers: { Authorization: `Bearer ${token}` } } } });
    if (process.platform !== 'win32') expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run test/mcpHost.test.ts`
Expected: FAIL — `h.addClient is not a function`.

- [ ] **Step 3: Implement**

In `src/main/agents/bossTools.ts`, replace the `ToolDef` interface with:

```ts
/** Who is calling a tool: set by the MCP host from the caller's token (employee tools need it). */
export interface ToolContext { agentId?: string }

/** A tool result shown to the model as an image (e.g. a screenshot), with an optional text note. */
export interface ToolImage { type: 'image'; data: string; mimeType: string; note?: string }
export const isToolImage = (v: unknown): v is ToolImage =>
  typeof v === 'object' && v !== null && (v as ToolImage).type === 'image' && typeof (v as ToolImage).data === 'string';

export interface ToolDef {
  name: string;
  description: string;
  input: z.ZodRawShape;
  run(args: unknown, ctx?: ToolContext): Promise<unknown>;
}
```

and the `tool()` helper keeps working unchanged (its `run` ignores `ctx`).

In `src/main/mcp/mcpHost.ts`:
- import `type ToolContext` and `isToolImage` from `../agents/bossTools`.
- add `private clients = new Map<string, string>(); // token -> agentId`
- add:

```ts
  /** A token for one employee; tools called with it get that employee's id. Replaces the employee's old token. */
  addClient(agentId: string): string {
    this.removeClient(agentId);
    const token = randomBytes(24).toString('hex');
    this.clients.set(token, agentId);
    return token;
  }

  removeClient(agentId: string): void {
    for (const [t, id] of this.clients) if (id === agentId) this.clients.delete(t);
  }

  async writeClientConfig(_agentId: string, token: string, file: string): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const config = { mcpServers: { [this.name]: { type: 'http', url: this.url, headers: { Authorization: `Bearer ${token}` } } } };
    await fs.writeFile(file, JSON.stringify(config, null, 2), { mode: 0o600 });
    await fs.chmod(file, 0o600).catch(() => undefined);
  }
```

- replace `authorized` with a resolver that compares in constant time against the main token and each client token:

```ts
  /** The caller's context for a valid bearer token, or null. */
  private caller(header: string | undefined): ToolContext | null {
    const got = Buffer.from(header ?? '');
    const same = (token: string) => {
      const expected = Buffer.from(`Bearer ${token}`);
      return got.length === expected.length && timingSafeEqual(got, expected);
    };
    if (same(this.token)) return {};
    for (const [t, agentId] of this.clients) if (same(t)) return { agentId };
    return null;
  }
```

- in `handle`: `const ctx = this.caller(req.headers.authorization); if (!ctx) throw new HttpError(401);` and `const mcp = this.buildServer(ctx);`
- `buildServer(ctx: ToolContext)`: call `t.run(args, ctx)`; if `isToolImage(value)` return `{ content: [{ type: 'image', data: value.data, mimeType: value.mimeType }, ...(value.note ? [{ type: 'text', text: value.note }] : [])] }`; otherwise the existing JSON text result.

- [ ] **Step 4: Run them**

Run: `npx vitest run test/mcpHost.test.ts test/bossTools.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/mcp/mcpHost.ts src/main/agents/bossTools.ts test/mcpHost.test.ts
git commit -m "feat(mcp): per-employee tokens, caller context and image results"
```

---

### Task 3: DevServerService

**Files:**
- Create: `src/main/browser/devServers.ts`
- Create: `test/fixtures/dev-server.mjs`
- Test: `test/devServers.test.ts`

**Interfaces:**
- Consumes: `splitCommand`, `freePort`, `stripAnsi` (Task 1); `killTree` from `src/main/claude/killTree.ts`.
- Produces:

```ts
export interface DevServerInfo { url: string; port: number; command: string; running: boolean }
export class DevServerService {
  constructor(opts: { cwdFor(agentId: string): string | undefined; waitMs?: number; onChange?(): void });
  start(agentId: string, command: string): Promise<{ url: string; port: number }>;
  info(agentId: string): DevServerInfo | null;
  logs(agentId: string, lines?: number): string;
  stop(agentId: string): Promise<boolean>;
  stopAll(): Promise<void>;
}
```

- [ ] **Step 1: Write the fixture and the failing test**

`test/fixtures/dev-server.mjs` (a stand-in dev server; `--die` exits at once, `--ignore-port` listens on a different port):

```js
import http from 'node:http';
if (process.argv.includes('--die')) { console.error('boom: cannot start'); process.exit(2); }
const port = process.argv.includes('--ignore-port') ? 0 : Number(process.env.PORT);
const portArg = process.argv.indexOf('--port');
const p = portArg > 0 ? Number(process.argv[portArg + 1]) : port;
http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end('<!doctype html><title>Fixture app</title><h1>Hello</h1><button onclick="document.querySelector(\'h1\').textContent=\'Clicked\'">Press me</button><input aria-label="Name"><script>console.error("fixture warning")</script>');
}).listen(p, '127.0.0.1', () => console.log(`\u001b[32mready\u001b[39m on ${p}`));
```

`test/devServers.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run test/devServers.test.ts`
Expected: FAIL — cannot resolve `../src/main/browser/devServers`.

- [ ] **Step 3: Implement** `src/main/browser/devServers.ts`

```ts
import http from 'node:http';
import spawn from 'cross-spawn';
import type { ChildProcess } from 'node:child_process';
import { killTree } from '../claude/killTree';
import { freePort, splitCommand, stripAnsi } from './rules';

export interface DevServerInfo { url: string; port: number; command: string; running: boolean }

interface Running { child: ChildProcess; info: DevServerInfo; lines: string[]; exited: Promise<void> }

const KEEP = 200;

/** One dev server per employee, started in that employee's worktree; stopped with its task, its employee or the project. */
export class DevServerService {
  private servers = new Map<string, Running>();

  constructor(private readonly opts: { cwdFor(agentId: string): string | undefined; waitMs?: number; onChange?(): void }) {}

  async start(agentId: string, command: string): Promise<{ url: string; port: number }> {
    const cwd = this.opts.cwdFor(agentId);
    if (!cwd) throw new Error('You have no working folder yet; start a task first.');
    const port = await freePort();
    const [bin, ...args] = splitCommand(command, port);
    await this.stop(agentId);
    const child = spawn(bin, args, {
      cwd, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', BROWSER: 'none', CI: '1' },
    });
    const url = `http://127.0.0.1:${port}/`;
    const run: Running = { child, info: { url, port, command, running: true }, lines: [], exited: Promise.resolve() };
    run.exited = new Promise((resolve) => {
      child.once('exit', () => { run.info.running = false; resolve(); this.opts.onChange?.(); });
      child.once('error', (e) => { run.lines.push(`Could not start: ${e.message}`); run.info.running = false; resolve(); });
    });
    const add = (chunk: Buffer) => {
      for (const l of stripAnsi(chunk.toString('utf8')).split(/\r?\n/)) if (l.trim()) run.lines.push(l);
      if (run.lines.length > KEEP) run.lines.splice(0, run.lines.length - KEEP);
    };
    child.stdout?.on('data', add);
    child.stderr?.on('data', add);
    this.servers.set(agentId, run);
    this.opts.onChange?.();

    const deadline = Date.now() + (this.opts.waitMs ?? 90_000);
    while (Date.now() < deadline) {
      if (!run.info.running) {
        this.servers.delete(agentId);
        throw new Error(`The dev server exited before it was ready. Last output:\n${run.lines.slice(-40).join('\n')}`);
      }
      if (await answers(port)) return { url, port };
      await new Promise((r) => setTimeout(r, 500));
    }
    await this.stop(agentId);
    throw new Error(`Nothing answered on port ${port} after ${Math.round((this.opts.waitMs ?? 90_000) / 1000)} s. The server may be ignoring the PORT variable: pass the port yourself with {port}, e.g. "npm run dev -- --port {port}". Last output:\n${run.lines.slice(-40).join('\n')}`);
  }

  info(agentId: string): DevServerInfo | null {
    const r = this.servers.get(agentId);
    return r ? { ...r.info } : null;
  }

  logs(agentId: string, lines = 60): string {
    const r = this.servers.get(agentId);
    if (!r) return 'No dev server is running.';
    return r.lines.slice(-Math.min(Math.max(1, lines), KEEP)).join('\n');
  }

  async stop(agentId: string): Promise<boolean> {
    const r = this.servers.get(agentId);
    if (!r) return false;
    this.servers.delete(agentId);
    if (r.info.running && r.child.pid) {
      killTree(r.child.pid);
      // Escalate if it ignores SIGTERM, then wait for the exit so ports and folders are free.
      const timer = setTimeout(() => { if (r.child.pid) killTree(r.child.pid, process.platform, 'SIGKILL'); }, 3000);
      await r.exited;
      clearTimeout(timer);
    }
    this.opts.onChange?.();
    return true;
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.servers.keys()].map((id) => this.stop(id)));
  }
}

function answers(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 1000 }, (res) => { res.resume(); resolve(true); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}
```

(`cross-spawn` is already a dependency; if its default import shape differs, mirror how `src/main/claude/runner.ts` imports it.)

- [ ] **Step 4: Run it**

Run: `npx vitest run test/devServers.test.ts && npm run typecheck`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/browser/devServers.ts test/fixtures/dev-server.mjs test/devServers.test.ts
git commit -m "feat(browser): dev servers run by the app in each employee's worktree"
```

---

### Task 4: BrowserService

**Files:**
- Modify: `package.json` (dependency `"playwright-core": "1.64.0"`)
- Create: `src/main/browser/browserService.ts`
- Test: `test/browser.test.ts`

**Interfaces:**
- Consumes: `allowedUrl`, `LOCAL_ONLY` (Task 1).
- Produces:

```ts
export const NO_BROWSER = 'No browser found. Install Google Chrome or Microsoft Edge, then try again.';
export class BrowserMissing extends Error {}
export interface TabInfo { agentId: string; url: string; title: string }
export interface Frame { agentId: string; data: string; width: number; height: number }
export type PreviewInput =
  | { kind: 'click'; x: number; y: number; button: 'left' | 'right' }
  | { kind: 'wheel'; x: number; y: number; dy: number }
  | { kind: 'key'; key: string }
  | { kind: 'text'; text: string };
export class BrowserService {
  constructor(opts?: { launch?: () => Promise<Browser>; onChange?(): void; onFrame?(f: Frame): void });
  available(): Promise<boolean>;
  pageFor(agentId: string): Promise<Page>;
  has(agentId: string): boolean;
  tabs(): Promise<TabInfo[]>;
  takeConsole(agentId: string): string[];
  takeUserNote(agentId: string): string | undefined;
  closeFor(agentId: string): Promise<void>;
  watch(agentId: string | null): Promise<void>;
  ack(): void;
  input(agentId: string, e: PreviewInput): Promise<void>;
  reload(agentId: string): Promise<void>;
  close(): Promise<void>;
}
```

- [ ] **Step 1: Add the dependency**

Run: `npm install --save-exact playwright-core@1.64.0`
Expected: `package.json` `dependencies` gains `"playwright-core": "1.64.0"`.

- [ ] **Step 2: Write the failing test** `test/browser.test.ts`

```ts
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
    await expect(page.goto(`${base}away`)).rejects.toThrow();
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

  it('says how to get a browser when none can start', async () => {
    const none = new BrowserService({ launch: async () => { throw new Error('no chrome'); } });
    expect(await none.available()).toBe(false);
    await expect(none.pageFor('a1')).rejects.toBeInstanceOf(BrowserMissing);
    await expect(none.pageFor('a1')).rejects.toThrow(NO_BROWSER);
    await none.close();
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run test/browser.test.ts`
Expected: FAIL — cannot resolve `../src/main/browser/browserService`.

- [ ] **Step 4: Implement** `src/main/browser/browserService.ts`

```ts
import { existsSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright-core';
import { allowedUrl } from './rules';

export const NO_BROWSER = 'No browser found. Install Google Chrome or Microsoft Edge, then try again.';
export class BrowserMissing extends Error { constructor() { super(NO_BROWSER); } }

export interface TabInfo { agentId: string; url: string; title: string }
export interface Frame { agentId: string; data: string; width: number; height: number }
export type PreviewInput =
  | { kind: 'click'; x: number; y: number; button: 'left' | 'right' }
  | { kind: 'wheel'; x: number; y: number; dy: number }
  | { kind: 'key'; key: string }
  | { kind: 'text'; text: string };

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
      await context.route('**/*', (route) => {
        const req = route.request();
        if (req.isNavigationRequest() && !allowedUrl(req.url())) return route.abort('blockedbyclient');
        return route.continue();
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
```

- [ ] **Step 5: Run it**

Run: `npx vitest run test/browser.test.ts && npm run typecheck`
Expected: PASS (5 tests; the 4 real-browser tests skip only if no Chrome/Edge/Playwright Chromium is installed — on this Mac, Chrome is).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/main/browser/browserService.ts test/browser.test.ts
git commit -m "feat(browser): one headless browser per project with a private tab per employee"
```

---

### Task 5: Employee tools

**Files:**
- Create: `src/main/browser/employeeTools.ts`
- Test: `test/employeeTools.test.ts`

**Interfaces:**
- Consumes: `ToolDef`, `ToolContext`, `ToolImage` (Task 2); `DevServerService` (Task 3); `BrowserService`, `BrowserMissing` (Task 4); `allowedUrl`, `LOCAL_ONLY` (Task 1).
- Produces: `employeeTools(d: { browser: BrowserService; devServers: DevServerService }): ToolDef[]` and `AGENT_KEYS: readonly string[]`.

- [ ] **Step 1: Write the failing test** `test/employeeTools.test.ts`

```ts
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run test/employeeTools.test.ts`
Expected: FAIL — cannot resolve `../src/main/browser/employeeTools`.

- [ ] **Step 3: Implement** `src/main/browser/employeeTools.ts`

```ts
import { z } from 'zod';
import type { ToolContext, ToolDef, ToolImage } from '../agents/bossTools';
import type { BrowserService } from './browserService';
import type { DevServerService } from './devServers';
import { LOCAL_ONLY, allowedUrl } from './rules';

export const AGENT_KEYS = ['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Space'] as const;
const MAX_SNAPSHOT = 40 * 1024;
const MAX_SHOT = 2 * 1024 * 1024;

function def<S extends z.ZodRawShape>(name: string, description: string, input: S, run: (args: z.infer<z.ZodObject<S>>, agentId: string) => Promise<unknown>): ToolDef {
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
    def('start_dev_server', 'Start the project\'s dev server in your folder on a free port (e.g. "npm run dev"; "{port}" in the command is replaced by the port). Returns the URL to open. No shell: use a package script for compound commands. It stops when your task ends.',
      { command: z.string().min(1).max(300) }, async ({ command }, agentId) => devServers.start(agentId, command)),
    def('dev_server_logs', 'Read the last lines of your dev server\'s output.', { lines: z.number().int().min(1).max(200).optional() },
      async ({ lines }, agentId) => devServers.logs(agentId, lines ?? 60)),
    def('stop_dev_server', 'Stop your dev server.', {}, async (_a, agentId) => ({ stopped: await devServers.stop(agentId) })),
    def('browser_open', 'Open a local URL (localhost / 127.0.0.1 only) in your private browser tab.', { url: z.string().min(1).max(2000) }, async ({ url }, agentId) => {
      const u = allowedUrl(url);
      if (!u) throw new Error(LOCAL_ONLY);
      const page = await browser.pageFor(agentId);
      const res = await page.goto(u.href, { timeout: 30_000 });
      return withNote(agentId, { url: page.url(), title: await page.title(), status: res?.status() ?? null });
    }),
    def('browser_snapshot', 'Read your tab as an accessibility outline. Elements have [ref=eN] ids to use with browser_click and browser_type. Refs change after every snapshot.', {}, async (_a, agentId) => {
      const page = await browser.pageFor(agentId);
      const snap = await page.ariaSnapshot({ mode: 'ai', timeout: 10_000 });
      const head = `Page: ${page.url()} — ${await page.title()}\n`;
      const note = browser.takeUserNote(agentId);
      const body = snap.length > MAX_SNAPSHOT ? `${snap.slice(0, MAX_SNAPSHOT)}\n… (cut at 40 KB)` : snap;
      return `${note ? `${note}\n` : ''}${head}${body}`;
    }),
    def('browser_click', 'Click an element by its ref from the latest browser_snapshot.', { ref: z.string().min(1).max(20), double: z.boolean().optional() }, async ({ ref, double }, agentId) => {
      const page = await browser.pageFor(agentId);
      await page.getByRef(ref).click({ timeout: 10_000, clickCount: double ? 2 : 1 }).catch(staleRef);
      return withNote(agentId, { ok: true, url: page.url(), title: await page.title() });
    }),
    def('browser_type', 'Fill a text field by its ref, optionally pressing Enter after.', { ref: z.string().min(1).max(20), text: z.string().max(5000), submit: z.boolean().optional() }, async ({ ref, text, submit }, agentId) => {
      const page = await browser.pageFor(agentId);
      await page.getByRef(ref).fill(text, { timeout: 10_000 }).catch(staleRef);
      if (submit) await page.keyboard.press('Enter');
      return withNote(agentId, { ok: true });
    }),
    def('browser_press', 'Press a key in your tab.', { key: z.enum(AGENT_KEYS) }, async ({ key }, agentId) => {
      const page = await browser.pageFor(agentId);
      await page.keyboard.press(key === 'Space' ? ' ' : key);
      return withNote(agentId, { ok: true });
    }),
    def('browser_screenshot', 'Take a screenshot of your tab (the visible part, or the full page).', { full_page: z.boolean().optional() }, async ({ full_page }, agentId) => {
      const page = await browser.pageFor(agentId);
      let buf = await page.screenshot({ type: 'png', fullPage: full_page ?? false, timeout: 10_000 });
      let mimeType = 'image/png';
      if (buf.length > MAX_SHOT) { buf = await page.screenshot({ type: 'jpeg', quality: 70, fullPage: full_page ?? false }); mimeType = 'image/jpeg'; }
      const image: ToolImage = { type: 'image', data: buf.toString('base64'), mimeType, note: browser.takeUserNote(agentId) };
      return image;
    }),
    def('browser_console', 'Console errors and warnings, page errors and failed requests since you last asked.', {}, async (_a, agentId) => {
      const lines = browser.takeConsole(agentId);
      return lines.length > 0 ? lines.join('\n') : 'Nothing new.';
    }),
    def('browser_resize', 'Resize your tab to check other screen sizes (e.g. 390x844 for a phone).', { width: z.number().int().min(320).max(2560), height: z.number().int().min(320).max(1600) }, async ({ width, height }, agentId) => {
      const page = await browser.pageFor(agentId);
      await page.setViewportSize({ width, height });
      return withNote(agentId, { ok: true });
    }),
  ];
}
```

- [ ] **Step 4: Run it**

Run: `npx vitest run test/employeeTools.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/browser/employeeTools.ts test/employeeTools.test.ts
git commit -m "feat(browser): employee tools for dev servers and the browser tab"
```

---

### Task 6: Wire it into the project (manager, service, prompt, fake CLI)

**Files:**
- Modify: `src/shared/types.ts` (`Project.browserTools`, `ProjectPatch.browserTools`, `WorkspaceEvent` `preview-changed`)
- Modify: `src/main/store/validate.ts` (`projectPatchSchema.browserTools`)
- Modify: `src/main/agents/agentManager.ts` (deps `employeeMcp`, spawn sites, `work-ended` and `fired` events)
- Modify: `src/main/agents/prompt.ts` (`PromptContext.browserTools`, employee rule line)
- Modify: `src/main/workspace/projectService.ts` (create and close the services, per-agent config, forward events)
- Modify: `src/renderer/src/components/ProjectSettingsView.tsx` (checkbox)
- Modify: `test/fake-claude/fake-claude.mjs` (boss detection, `FAKE_CLAUDE_MCP_CALLS`)
- Create: `test/fixtures/browser-repo.ts` (helper to put the fixture server into a test repo)
- Test: `test/teamBrowser.test.ts`, `src/main/agents/prompt.test.ts`

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces:
  - `AgentManagerDeps.employeeMcp?: (agent: Agent) => Promise<string | null>`
  - `ManagerEvent` gains `{ type: 'work-ended'; agentId: string }` and `{ type: 'fired'; agentId: string }`
  - `WorkspaceEvent` gains `{ type: 'preview-changed' }`
  - `ProjectService` private workspace fields `browser: BrowserService`, `devServers: DevServerService`, `office: McpHost` (used by Task 7).

- [ ] **Step 1: Write the failing tests**

Append to `src/main/agents/prompt.test.ts`:

```ts
describe('renderPrompt (browser tools)', () => {
  it('tells employees how to check UI work only when the browser is on', () => {
    const on = renderPrompt(role, [], { agentName: 'Pixel', bossName: 'Max', branch: 'b', projectName: 'demo', kind: 'employee', browserTools: true });
    expect(on).toContain('`start_dev_server`');
    expect(on).toContain('`browser_open`');
    expect(renderPrompt(role, [], { agentName: 'Pixel', bossName: 'Max', branch: 'b', projectName: 'demo', kind: 'employee' })).not.toContain('start_dev_server');
  });
});
```

`test/fixtures/browser-repo.ts`:

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** Commits the fixture dev server as server.mjs so employee worktrees have it. */
export async function addFixtureServer(repo: string): Promise<void> {
  await fs.copyFile(path.resolve('test/fixtures/dev-server.mjs'), path.join(repo, 'server.mjs'));
  execFileSync('git', ['add', 'server.mjs'], { cwd: repo });
  execFileSync('git', ['commit', '-q', '-m', 'add server'], { cwd: repo });
}
```

`test/teamBrowser.test.ts` (uses `ProjectService` with the fake CLI, like `test/projectService.test.ts`):

```ts
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
    expect(await svc.previewList()).toEqual([expect.objectContaining({ agentId: pixel.id, title: 'Fixture app', devServer: null })]);
    const argv = (await launches()).find((l) => !l.argv.includes('mcp__agentoffice'))!.argv;
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
    const argv = (await launches()).find((l) => !l.argv.includes('mcp__agentoffice'))!.argv;
    expect(argv).not.toContain('--mcp-config');
  }, 60_000);
});
```

(`svc.tools()` returns the boss tools, the same way `test/projectService.test.ts` hires and assigns.)

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/main/agents/prompt.test.ts test/teamBrowser.test.ts`
Expected: FAIL — no browser line in the prompt; `browserTools` not accepted / no `previewList`.

- [ ] **Step 3: Fake CLI**

In `test/fake-claude/fake-claude.mjs`:
- Replace the boss check `!argv.includes('--mcp-config')` with `!isBoss` where `const isBoss = argv.includes('mcp__agentoffice');` (defined near `flag`).
- Before writing the `result`, when `env.FAKE_CLAUDE_MCP_CALLS` is set and this is not the boss and `--mcp-config` is present, make the calls and put their text into the result:

```js
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/** Calls the employee tools listed in FAKE_CLAUDE_MCP_CALLS; "$URL" in args becomes the last returned url. */
async function mcpCalls() {
  const cfg = JSON.parse(fs.readFileSync(flag('--mcp-config'), 'utf8'));
  const server = Object.values(cfg.mcpServers)[0];
  const client = new Client({ name: 'fake-claude', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers } }));
  const lines = [];
  let lastUrl = '';
  for (const c of JSON.parse(env.FAKE_CLAUDE_MCP_CALLS)) {
    const args = JSON.parse(JSON.stringify(c.args ?? {}).split('$URL').join(lastUrl));
    const r = await client.callTool({ name: c.tool, arguments: args });
    const text = (r.content ?? []).map((x) => x.text ?? `[${x.type}]`).join(' ');
    try { const v = JSON.parse(text); if (v && typeof v.url === 'string') lastUrl = v.url; } catch { /* not JSON */ }
    lines.push(`${c.tool}${r.isError ? ' (error)' : ''}: ${text.slice(0, 300)}`);
  }
  await client.close();
  return lines.join('\n');
}
```

and in `handle`, compute `const mcpText = env.FAKE_CLAUDE_MCP_CALLS && !isBoss && flag('--mcp-config') ? await mcpCalls().catch((e) => `mcp failed: ${e.message}`) : '';` and use `result: fail ? 'simulated failure' : (env.FAKE_CLAUDE_RESULT ?? (mcpText || `echo: ${content.slice(0, 200)}`))`.

- [ ] **Step 4: Implement the wiring**

`src/shared/types.ts`:
- `Project` gains `/** Employees get the browser tools (undefined = on). */ browserTools?: boolean;`
- `ProjectPatch` gains `browserTools?: boolean`.
- `WorkspaceEvent` gains `| { type: 'preview-changed' }`.

`src/main/store/validate.ts`: `projectPatchSchema` gains `browserTools: z.boolean().optional(),`.

`src/main/agents/prompt.ts`: `PromptContext` gains `/** Employee only: the browser tools are available. */ browserTools?: boolean;` and the employee `## Rules` list gains, when `ctx.browserTools`:

```ts
        ...(ctx.browserTools ? ['- To check UI work: `start_dev_server` with the project\'s dev command, `browser_open` the URL it returns, use `browser_snapshot`, `browser_click`, `browser_type` and `browser_screenshot` to verify, and say in your summary what you checked.'] : []),
```

`src/main/agents/agentManager.ts`:
- `AgentManagerDeps` gains `/** The employee's MCP config file (browser tools), or null when they are off. */ employeeMcp?: (agent: Agent) => Promise<string | null>;`
- `ManagerEvent` gains `| { type: 'work-ended'; agentId: string } | { type: 'fired'; agentId: string }`.
- `spawn(...)` gains a last parameter `mcp: string | null` and its `launch` uses `mcpConfigPath: mcp ?? undefined` and `allowedTools: mcp ? [...role.allowedTools, 'mcp__office'] : role.allowedTools`.
- At each of the three `this.spawn(` call sites, compute `const mcp = (await this.d.employeeMcp?.(agent)) ?? null;` just before and pass it.
- `writePrompt` passes `browserTools: this.d.project.browserTools !== false` in the context.
- `setStatus`: after `Object.assign(...)`, add `if (from === 'working' && to !== 'working') this.emitEvent({ type: 'work-ended', agentId: task.assigneeId });`
- `fire`: after `await this.saveAgents();` add `this.emitEvent({ type: 'fired', agentId: agent.id });`

`src/main/workspace/projectService.ts`:
- imports: `BrowserService`, `DevServerService`, `employeeTools`, `McpHost` (already).
- `Workspace` gains `browser: BrowserService; devServers: DevServerService; office: McpHost;`.
- in `open()`, before `new AgentManager(...)`:

```ts
    // Employees' browser and dev servers, and the tool server they reach them through (one token per employee).
    let managerRef: AgentManager | null = null;
    const devServers = new DevServerService({
      cwdFor: (agentId) => managerRef?.agents().find((a) => a.id === agentId)?.worktreePath,
      onChange: () => { if (ws) this.emitWs(ws, { type: 'preview-changed' }); },
    });
    const browser = new BrowserService({
      onChange: () => { if (ws) this.emitWs(ws, { type: 'preview-changed' }); },
      onFrame: (f) => { if (this.ws === ws) this.emit('preview-frame', f); },
    });
    const office = new McpHost(employeeTools({ browser, devServers }), 'office');
    await office.start();
    const employeeMcp = async (agent: Agent): Promise<string | null> => {
      if (project.browserTools === false) return null;
      const file = path.join(this.d.paths.projectDir(id), `mcp-${agent.id}.json`);
      await office.writeClientConfig(agent.id, office.addClient(agent.id), file);
      return file;
    };
```

  pass `employeeMcp` into the `AgentManager` deps, set `managerRef = manager;` right after construction, and move the `let ws!: Workspace;` declaration above this block (it is already declared before `bossTools`; move it up). Include `browser, devServers, office` in the `ws = { ... }` object. In the `catch` that cleans up after a failed `writeConfig`, also `await office.close()`.
- `forward()` gains:

```ts
      case 'work-ended': void ws.devServers.stop(e.agentId); return undefined;
      case 'fired': void ws.devServers.stop(e.agentId); void ws.browser.closeFor(e.agentId); ws.office.removeClient(e.agentId); return undefined;
```

- `close()`: after `await ws.manager.shutdown();` add `await ws.devServers.stopAll(); await ws.browser.close(); await ws.office.close();`.
- Add:

```ts
  async previewList(): Promise<{ agentId: string; url: string; title: string; devServer: { url: string; running: boolean } | null }[]> {
    const ws = this.mustWs();
    return (await ws.browser.tabs()).map((t) => {
      const d = ws.devServers.info(t.agentId);
      return { ...t, devServer: d ? { url: d.url, running: d.running } : null };
    });
  }
```

`ProjectSettingsView.tsx`: add state `const [browserTools, setBrowserTools] = useState(ws.project.browserTools !== false);`, include `browserTools` in the `updateProject({...})` call, and a checkbox after the auto-merge one:

```tsx
        <label className="row"><input type="checkbox" checked={browserTools} onChange={(e) => setBrowserTools(e.target.checked)} style={{ width: 18, height: 18 }} /> Employees can use a browser to check their work</label>
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/main/agents/prompt.test.ts test/teamBrowser.test.ts test/projectService.test.ts test/agentManager.test.ts test/bossSession.test.ts && npm run typecheck`
Expected: PASS. Then the whole suite: `npm test` → all pass (the fake CLI boss check change must not break the existing tests; if any test launched an employee with `--mcp-config` and expected a file write, it now writes — that is the intended fix).

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/store/validate.ts src/main/agents src/main/workspace/projectService.ts src/renderer/src/components/ProjectSettingsView.tsx test/fake-claude/fake-claude.mjs test/fixtures/browser-repo.ts test/teamBrowser.test.ts
git commit -m "feat(browser): employees get browser tools through their own MCP server"
```

---

### Task 7: Preview IPC

**Files:**
- Create: `src/main/browser/previewArgs.ts`
- Test: `src/main/browser/previewArgs.test.ts`
- Modify: `src/shared/ipc.ts`, `src/shared/types.ts` (`PreviewTab`, `PreviewFrame`, `PreviewInput`)
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/workspace/projectService.ts` (`previewWatch`, `previewAck`, `previewInput`, `previewReload`, `previewStopDevServer`)

**Interfaces:**
- Produces:
  - shared types: `PreviewTab = { agentId: string; url: string; title: string; devServer: { url: string; running: boolean } | null }`, `PreviewFrame = { agentId: string; data: string; width: number; height: number }`, `PreviewInput` (same union as Task 4; `BrowserService` re-exports it from shared).
  - `PREVIEW_KEYS` and `previewInput(v: unknown): PreviewInput` in `previewArgs.ts`.
  - IPC: `previewList`, `previewWatch(agentId | null)`, `previewAck()`, `previewInput(agentId, event)`, `previewReload(agentId)`, `previewStopDevServer(agentId)`, `onPreviewFrame(cb)`.

- [ ] **Step 1: Write the failing test** `src/main/browser/previewArgs.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { previewInput } from './previewArgs';

describe('previewInput', () => {
  it('accepts clicks, wheel, keys and text within limits', () => {
    expect(previewInput({ kind: 'click', x: 0.5, y: 1, button: 'left' })).toEqual({ kind: 'click', x: 0.5, y: 1, button: 'left' });
    expect(previewInput({ kind: 'wheel', x: 0, y: 0.2, dy: -120 })).toMatchObject({ kind: 'wheel', dy: -120 });
    expect(previewInput({ kind: 'key', key: 'Enter' })).toEqual({ kind: 'key', key: 'Enter' });
    expect(previewInput({ kind: 'text', text: 'héllo' })).toEqual({ kind: 'text', text: 'héllo' });
  });

  it('refuses anything else', () => {
    for (const bad of [null, 'click', { kind: 'click', x: 2, y: 0, button: 'left' }, { kind: 'click', x: 0, y: 0, button: 'middle' },
      { kind: 'wheel', x: 0, y: 0, dy: 99999 }, { kind: 'key', key: 'Meta+Q' }, { kind: 'text', text: 'x'.repeat(1001) }, { kind: 'eval', code: '1' },
      { kind: 'click', x: 0, y: 0, button: 'left', extra: 1 }])
      expect(() => previewInput(bad), JSON.stringify(bad)).toThrow();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/main/browser/previewArgs.test.ts`
Expected: FAIL — cannot resolve `./previewArgs`.

- [ ] **Step 3: Implement**

`src/shared/types.ts`:

```ts
export interface PreviewTab { agentId: string; url: string; title: string; devServer: { url: string; running: boolean } | null }
export interface PreviewFrame { agentId: string; data: string; width: number; height: number }
export type PreviewInput =
  | { kind: 'click'; x: number; y: number; button: 'left' | 'right' }
  | { kind: 'wheel'; x: number; y: number; dy: number }
  | { kind: 'key'; key: string }
  | { kind: 'text'; text: string };
```

In `browserService.ts`, replace its local `PreviewInput` and `Frame` with `import type { PreviewFrame as Frame, PreviewInput } from '../../shared/types';` and `export type { PreviewInput };`.

`src/main/browser/previewArgs.ts`:

```ts
import { z } from 'zod';
import type { PreviewInput } from '../../shared/types';

/** Keys the Preview tab may send; printable characters go as text. */
export const PREVIEW_KEYS = ['Enter', 'Tab', 'Shift+Tab', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'] as const;
const frac = z.number().min(0).max(1);
const schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('click'), x: frac, y: frac, button: z.enum(['left', 'right']) }).strict(),
  z.object({ kind: z.literal('wheel'), x: frac, y: frac, dy: z.number().min(-5000).max(5000) }).strict(),
  z.object({ kind: z.literal('key'), key: z.enum(PREVIEW_KEYS) }).strict(),
  z.object({ kind: z.literal('text'), text: z.string().min(1).max(1000) }).strict(),
]);

/** Preview input comes from the renderer: check it before it reaches an employee's tab. */
export function previewInput(v: unknown): PreviewInput {
  const r = schema.safeParse(v);
  if (!r.success) throw new Error('Invalid preview input');
  return r.data;
}
```

`src/shared/ipc.ts` — `IPC` gains:

```ts
  previewList: 'preview:list',
  previewWatch: 'preview:watch',
  previewAck: 'preview:ack',
  previewInput: 'preview:input',
  previewReload: 'preview:reload',
  previewStopDevServer: 'preview:stop-dev-server',
  previewFrame: 'preview:frame',
```

and `AgentOfficeApi` gains:

```ts
  previewList(): Promise<PreviewTab[]>;
  previewWatch(agentId: string | null): Promise<void>;
  previewAck(): Promise<void>;
  previewInput(agentId: string, event: PreviewInput): Promise<void>;
  previewReload(agentId: string): Promise<void>;
  previewStopDevServer(agentId: string): Promise<void>;
  onPreviewFrame(cb: (f: PreviewFrame) => void): () => void;
```

(import the three types).

`src/preload/index.ts`:

```ts
  previewList: () => ipcRenderer.invoke(IPC.previewList),
  previewWatch: (agentId) => ipcRenderer.invoke(IPC.previewWatch, agentId),
  previewAck: () => ipcRenderer.invoke(IPC.previewAck),
  previewInput: (agentId, event) => ipcRenderer.invoke(IPC.previewInput, agentId, event),
  previewReload: (agentId) => ipcRenderer.invoke(IPC.previewReload, agentId),
  previewStopDevServer: (agentId) => ipcRenderer.invoke(IPC.previewStopDevServer, agentId),
  onPreviewFrame: (cb) => {
    const listener = (_e: unknown, f: Parameters<typeof cb>[0]) => cb(f);
    ipcRenderer.on(IPC.previewFrame, listener);
    return () => { ipcRenderer.removeListener(IPC.previewFrame, listener); };
  },
```

`src/main/workspace/projectService.ts`:

```ts
  async previewWatch(agentId: string | null): Promise<void> { await this.mustWs().browser.watch(agentId); }
  previewAck(): void { this.ws?.browser.ack(); }
  async previewInput(agentId: string, e: PreviewInput): Promise<void> { await this.mustWs().browser.input(agentId, e); }
  async previewReload(agentId: string): Promise<void> { await this.mustWs().browser.reload(agentId); }
  async previewStopDevServer(agentId: string): Promise<void> { await this.mustWs().devServers.stop(agentId); }
```

`src/main/index.ts` (next to the terminal handlers; `previewInput` imported from `./browser/previewArgs` as `checkPreviewInput`):

```ts
  handle(IPC.previewList, () => svc.previewList());
  handle(IPC.previewWatch, (agentId: unknown) => svc.previewWatch(agentId === null ? null : str(agentId, 'agent id')));
  handle(IPC.previewAck, () => svc.previewAck());
  handle(IPC.previewInput, (agentId: unknown, ev: unknown) => svc.previewInput(str(agentId, 'agent id'), checkPreviewInput(ev)));
  handle(IPC.previewReload, (agentId: unknown) => svc.previewReload(str(agentId, 'agent id')));
  handle(IPC.previewStopDevServer, (agentId: unknown) => svc.previewStopDevServer(str(agentId, 'agent id')));
```

and next to `service.on('terminal', …)`: `service.on('preview-frame', (f) => win?.webContents.send(IPC.previewFrame, f));`

- [ ] **Step 4: Run it**

Run: `npx vitest run src/main/browser/previewArgs.test.ts test/browser.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/browser src/shared src/preload/index.ts src/main/index.ts src/main/workspace/projectService.ts
git commit -m "feat(browser): preview IPC: watch, frames, validated input"
```

---

### Task 8: Preview tab

**Files:**
- Create: `src/renderer/src/preview/input.ts`
- Test: `src/renderer/src/preview/input.test.ts`
- Create: `src/renderer/src/components/PreviewView.tsx`
- Modify: `src/renderer/src/state.ts` (`View` gains `{ name: 'preview' }`)
- Modify: `src/renderer/src/memory.ts` (`RememberedView` and `VIEWS` gain `'preview'`) and `memory.test.ts` if it lists views
- Modify: `src/renderer/src/components/Header.tsx` (`TABS` gains Preview after History)
- Modify: `src/renderer/src/App.tsx` (render case, remember `preview` in the view-memory effect)
- Modify: `src/renderer/src/styles/app.css`
- Modify: `e2e/smoke.spec.ts` (new test)

**Interfaces:**
- Consumes: Task 7 IPC; `PreviewTab`, `PreviewInput`.
- Produces: `fitRect(boxW, boxH, frameW, frameH): { x: number; y: number; w: number; h: number }`, `toFraction(px: number, py: number, rect: { x: number; y: number; w: number; h: number }): { x: number; y: number } | null`, `keyToInput(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): PreviewInput | null`, `statusLine(tab: PreviewTab, name: string): string`.

- [ ] **Step 1: Write the failing test** `src/renderer/src/preview/input.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { fitRect, keyToInput, statusLine, toFraction } from './input';

const k = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) =>
  ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

describe('fitRect / toFraction', () => {
  it('letterboxes the frame inside the box and maps clicks back to the page', () => {
    const r = fitRect(1000, 1000, 1280, 800);
    expect(r).toEqual({ x: 0, y: 187.5, w: 1000, h: 625 });
    expect(toFraction(500, 500, r)).toEqual({ x: 0.5, y: 0.5 });
    expect(toFraction(500, 100, r)).toBeNull();
  });
});

describe('keyToInput', () => {
  it('sends printable characters as text and named keys as keys', () => {
    expect(keyToInput(k('a'))).toEqual({ kind: 'text', text: 'a' });
    expect(keyToInput(k('Enter'))).toEqual({ kind: 'key', key: 'Enter' });
    expect(keyToInput(k('Tab', { shiftKey: true }))).toEqual({ kind: 'key', key: 'Shift+Tab' });
  });
  it('leaves app shortcuts and unknown keys alone', () => {
    expect(keyToInput(k('c', { metaKey: true }))).toBeNull();
    expect(keyToInput(k('`', { ctrlKey: true }))).toBeNull();
    expect(keyToInput(k('F5'))).toBeNull();
    expect(keyToInput(k('Shift'))).toBeNull();
  });
});

describe('statusLine', () => {
  it('says who, where and whether the dev server runs', () => {
    expect(statusLine({ agentId: 'a', url: 'http://127.0.0.1:5174/', title: 'App', devServer: { url: 'http://127.0.0.1:5174/', running: true } }, 'Pixel'))
      .toBe('Pixel · http://127.0.0.1:5174/ · dev server running');
    expect(statusLine({ agentId: 'a', url: 'about:blank', title: '', devServer: null }, 'Pixel')).toBe('Pixel · about:blank · no dev server');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/renderer/src/preview/input.test.ts`
Expected: FAIL — cannot resolve `./input`.

- [ ] **Step 3: Implement the helpers** `src/renderer/src/preview/input.ts`

```ts
import type { PreviewInput, PreviewTab } from '../../../shared/types';

const KEYS = new Set(['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);

/** Where a frame of frameW×frameH is drawn inside a box, keeping its shape. */
export function fitRect(boxW: number, boxH: number, frameW: number, frameH: number) {
  const scale = Math.min(boxW / frameW, boxH / frameH);
  const w = frameW * scale;
  const h = frameH * scale;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
}

/** A point in the box as a fraction of the page, or null outside the drawn frame. */
export function toFraction(px: number, py: number, r: { x: number; y: number; w: number; h: number }): { x: number; y: number } | null {
  const x = (px - r.x) / r.w;
  const y = (py - r.y) / r.h;
  return x < 0 || x > 1 || y < 0 || y > 1 ? null : { x, y };
}

/** Typing in the live view: characters as text, a few named keys; app shortcuts (Ctrl/Cmd/Alt) stay with the app. */
export function keyToInput(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): PreviewInput | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if ([...e.key].length === 1) return { kind: 'text', text: e.key };
  if (e.key === 'Tab' && e.shiftKey) return { kind: 'key', key: 'Shift+Tab' };
  return KEYS.has(e.key) ? { kind: 'key', key: e.key } : null;
}

export function statusLine(t: PreviewTab, name: string): string {
  const dev = !t.devServer ? 'no dev server' : t.devServer.running ? 'dev server running' : 'dev server stopped';
  return `${name} · ${t.url} · ${dev}`;
}
```

- [ ] **Step 4: Run it**

Run: `npx vitest run src/renderer/src/preview/input.test.ts`
Expected: PASS.

- [ ] **Step 5: The view and its wiring**

`src/renderer/src/components/PreviewView.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import type { PreviewTab, WorkspaceSnapshot } from '../../../shared/types';
import { fitRect, keyToInput, statusLine, toFraction } from '../preview/input';

interface Props { ws: WorkspaceSnapshot; onError: (m: string) => void }

/** Watch an employee's browser tab live, and click or type into it. */
export function PreviewView({ ws, onError }: Props) {
  const [tabs, setTabs] = useState<PreviewTab[]>([]);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [frames, setFrames] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const frameSize = useRef({ w: 1280, h: 800 });
  const fail = (e: unknown) => onError(String(e));
  const nameOf = (id: string) => ws.agents.find((a) => a.id === id)?.name ?? 'Employee';

  const refresh = () => window.agentOffice.previewList().then((list) => {
    setTabs(list);
    setAgentId((cur) => (cur && list.some((t) => t.agentId === cur) ? cur : list[0]?.agentId ?? null));
  }, fail);
  useEffect(() => {
    void refresh();
    return window.agentOffice.onEvent((e) => { if (e.type === 'preview-changed') void refresh(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Stream only the selected tab, and only while this view is open.
  useEffect(() => {
    void window.agentOffice.previewWatch(agentId).catch(fail);
    const off = window.agentOffice.onPreviewFrame((f) => {
      if (f.agentId !== agentId || !canvas.current) { void window.agentOffice.previewAck(); return; }
      const img = new Image();
      img.onload = () => {
        const c = canvas.current;
        if (c) {
          const box = c.getBoundingClientRect();
          c.width = Math.round(box.width * devicePixelRatio);
          c.height = Math.round(box.height * devicePixelRatio);
          const ctx = c.getContext('2d')!;
          const r = fitRect(c.width, c.height, img.width, img.height);
          ctx.clearRect(0, 0, c.width, c.height);
          ctx.drawImage(img, r.x, r.y, r.w, r.h);
          frameSize.current = { w: img.width, h: img.height };
          setFrames((n) => n + 1);
        }
        void window.agentOffice.previewAck();
      };
      img.src = `data:image/jpeg;base64,${f.data}`;
    });
    return () => { off(); void window.agentOffice.previewWatch(null); };
  }, [agentId]); // eslint-disable-line react-hooks/exhaustive-deps

  const at = (e: { clientX: number; clientY: number }) => {
    const c = canvas.current!;
    const box = c.getBoundingClientRect();
    return toFraction(e.clientX - box.left, e.clientY - box.top, fitRect(box.width, box.height, frameSize.current.w, frameSize.current.h));
  };
  const send = (ev: Parameters<typeof window.agentOffice.previewInput>[1]) => { if (agentId) void window.agentOffice.previewInput(agentId, ev).catch(fail); };
  const tab = tabs.find((t) => t.agentId === agentId);

  if (tabs.length === 0) {
    return (
      <div className="preview preview-empty">
        <p className="muted">An employee's browser tab appears here when it starts testing.</p>
      </div>
    );
  }
  return (
    <div className="preview">
      <div className="row preview-bar">
        <label htmlFor="preview-agent" className="small muted">Employee</label>
        <select id="preview-agent" className="input" value={agentId ?? ''} onChange={(e) => setAgentId(e.target.value)}>
          {tabs.map((t) => <option key={t.agentId} value={t.agentId}>{nameOf(t.agentId)}</option>)}
        </select>
        {tab && <span className="small muted mono preview-status" title={tab.title}>{statusLine(tab, nameOf(tab.agentId))}</span>}
        <span className="preview-actions">
          <button type="button" className="btn small" disabled={!agentId} onClick={() => agentId && void window.agentOffice.previewReload(agentId).catch(fail)}>Reload</button>
          <button type="button" className="btn small" disabled={!tab?.url.startsWith('http')} onClick={() => tab && void window.agentOffice.openExternal(tab.url).catch(fail)}>Open in my browser</button>
          <button type="button" className="btn small" disabled={!tab?.devServer?.running} onClick={() => agentId && void window.agentOffice.previewStopDevServer(agentId).catch(fail)}>Stop dev server</button>
        </span>
      </div>
      <canvas
        ref={canvas}
        className="preview-canvas"
        tabIndex={0}
        data-frames={frames}
        aria-label={`Live view of ${tab ? nameOf(tab.agentId) : 'the employee'}'s browser tab`}
        onMouseDown={(e) => { e.currentTarget.focus(); const p = at(e); if (p) send({ kind: 'click', x: p.x, y: p.y, button: e.button === 2 ? 'right' : 'left' }); }}
        onContextMenu={(e) => e.preventDefault()}
        onWheel={(e) => { const p = at(e); if (p) send({ kind: 'wheel', x: p.x, y: p.y, dy: Math.max(-5000, Math.min(5000, e.deltaY)) }); }}
        onKeyDown={(e) => { const ev = keyToInput(e); if (ev) { e.preventDefault(); send(ev); } }}
      />
    </div>
  );
}
```

Wiring:
- `state.ts`: `View` gains `| { name: 'preview' }`.
- `memory.ts`: `RememberedView` and `VIEWS` gain `'preview'`.
- `Header.tsx`: the `TABS` type union gains `'preview'` and the list gains `{ name: 'preview', label: 'Preview' }` right after History.
- `App.tsx`: import `PreviewView`; add `case 'preview': return <PreviewView ws={ws} onError={onError} />;` next to `history`; the view-memory effect's condition gains `|| viewName === 'preview'`.
- `app.css`:

```css
/* Preview tab: a live view of an employee's browser tab */
.view:has(> .preview) { display: flex; flex-direction: column; min-height: 0; }
.preview { display: flex; flex-direction: column; gap: 10px; flex: 1; min-height: 0; }
.preview-bar { flex-wrap: wrap; gap: 8px 10px; align-items: center; }
.preview-bar select { max-width: 220px; }
.preview-status { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1 1 200px; }
.preview-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.preview-canvas { flex: 1; min-height: 240px; width: 100%; background: var(--bg); border: 1px solid var(--line); border-radius: 10px; cursor: pointer; }
.preview-canvas:focus-visible { outline: 2px solid var(--amber); outline-offset: 2px; }
.preview-empty { align-items: center; justify-content: center; }
```

(Check `.view:has(> .history)` in `app.css` and follow the same pattern if it differs.)

- [ ] **Step 6: e2e**

Add a test to `e2e/smoke.spec.ts` (uses existing `launch`, `seedTeam`, `reopen`, `makeRepo`; `addFixtureServer` from `../test/fixtures/browser-repo`):

```ts
test('the Preview tab shows an employee\'s browser tab live', async () => {
  const repo = await makeRepo();
  await addFixtureServer(repo);
  const env = {
    AO_CLAUDE_BIN: process.execPath, AO_CLAUDE_ARGS: JSON.stringify([FAKE]), AO_E2E_PICK_FOLDER: repo,
    FAKE_CLAUDE_MCP_CALLS: JSON.stringify([{ tool: 'start_dev_server', args: { command: 'node server.mjs' } }, { tool: 'browser_open', args: { url: '$URL' } }]),
  };
  let { app, userData } = await launch(env);
  try {
    let win = await app.firstWindow();
    await win.getByRole('button', { name: 'Browse' }).click();
    await win.getByRole('button', { name: /Open the office/ }).click();
    await expect(win.getByRole('button', { name: /^Max, Boss/ })).toBeVisible();
    await app.close();
    const pdir = await seedTeam(userData, [{ name: 'Pixel', roleId: 'frontend' }]);
    const pixel = (JSON.parse(await fs.readFile(path.join(pdir, 'agents.json'), 'utf8')) as { id: string; name: string }[]).find((a) => a.name === 'Pixel')!;
    const now = new Date().toISOString();
    await fs.writeFile(path.join(pdir, 'tasks.json'), JSON.stringify([{
      id: 'T-101', projectId: path.basename(pdir), title: 'Check the page', brief: 'look', assigneeId: pixel.id, createdBy: 'boss', status: 'queued',
      held: false, attempts: 0, branch: 'ao/pixel/check-t-101', dependsOn: [], createdAt: now, updatedAt: now, model: 'haiku',
    }]));
    ({ app, win } = await reopen(env, userData));
    await win.getByRole('navigation', { name: 'Project views' }).getByRole('button', { name: 'Preview' }).click();
    await expect(win.getByLabel('Employee')).toHaveValue(pixel.id, { timeout: 30_000 });
    const live = win.getByLabel(/Live view of Pixel/);
    await expect.poll(async () => Number(await live.getAttribute('data-frames')), { timeout: 20_000 }).toBeGreaterThan(0);
    await live.click({ position: { x: 20, y: 20 } });
  } finally {
    await app.close();
    await fs.rm(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    await fs.rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
```

- [ ] **Step 7: Run every gate**

Run: `npm run typecheck && npm test && npm run test:e2e`
Expected: all pass (8 e2e). Then screenshot the Preview tab with the fake CLI (scratchpad `shot-*.mjs` pattern) at 1280 and 800 px wide and check the layout.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src e2e/smoke.spec.ts
git commit -m "feat(ui): Preview tab with a live view of an employee's browser tab"
```

---

### Task 9: Packaging, CI and docs

**Files:**
- Modify: `electron-builder.yml` (`asarUnpack` playwright-core)
- Modify: `.github/workflows/ci.yml` (install Chromium)
- Modify: `AGENTS.md`

- [ ] **Step 1: Packaging**

`electron-builder.yml` `asarUnpack` gains:

```yaml
  # playwright-core reads its own scripts from disk and spawns the browser; keep it outside the asar.
  - "**/node_modules/playwright-core/**"
```

Run: `npm run pack` and check `release/*/AgentOffice.app/Contents/Resources/app.asar.unpacked/node_modules/playwright-core/package.json` exists (on macOS; the path differs per OS — `ls release`).

- [ ] **Step 2: CI**

In `.github/workflows/ci.yml`, after `npm ci`:

```yaml
      - run: npx playwright install chromium
        if: runner.os != 'Linux'
      - run: npx playwright install --with-deps chromium
        if: runner.os == 'Linux'
```

- [ ] **Step 3: AGENTS.md**

- Architecture tree: add after the `terminal/` line:
  `  browser/         BrowserService (one headless Chromium per project, a private tab per employee, screencast), DevServerService (one dev server per employee), employeeTools (the `office` MCP server's tools), rules, previewArgs`
- How a task flows, step 4: add a bullet "employees launch with their own `office` MCP config (`mcp-<agentId>.json`, per-employee token) unless the project turned the browser off".
- Security rules: add a bullet: "Employee browser tools reach only the caller's own tab and dev server (the token identifies the employee); only `localhost`/`127.0.0.1`/`[::1]` pages can be opened or navigated to; dev server commands run without a shell in the employee's worktree; Preview input is validated (`previewArgs.ts`) and agents have no channel to it. No remote-debugging port is opened."
- Testing conventions, fake CLI list: add "`FAKE_CLAUDE_MCP_CALLS`: JSON list of `{ tool, args }` the fake calls on its MCP config before replying (`$URL` = the last returned url)", and note the fake treats `--allowedTools mcp__agentoffice` (not `--mcp-config`) as "is the boss".
- Known gaps: "Preview: no in-app browser download (packaged builds cannot run Playwright's installer); the user installs Chrome or Edge."

- [ ] **Step 4: Run every gate**

Run: `npm run typecheck && npm test && npm run test:e2e`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add electron-builder.yml .github/workflows/ci.yml AGENTS.md
git commit -m "build(browser): unpack playwright-core, install Chromium in CI, document the team browser"
```
