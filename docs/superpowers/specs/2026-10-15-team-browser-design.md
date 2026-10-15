# Team Browser and Preview — Design Spec

Date: 2026-10-15
Status: Draft for review

## 1. Summary

Employees get a real browser to check their own work. Each open project has one hidden Chromium owned by the app; every employee gets a private tab in it and a dev server the app runs for them in their worktree. Employees drive their tab through a small set of AgentOffice browser tools. A new **Preview** tab streams any employee's tab live, and the user can click and type into it.

This is part 1 of 3. Part 2 (Android emulator) and part 3 (iOS Simulator) reuse the same pieces (employee tool server, Preview tab, per-employee device) and get their own specs.

## 2. Goals and non-goals

**Goals**
- An employee can start the project's dev server in its worktree, open it, read the page, click, type, resize, take screenshots and read console errors, without help.
- Employees working at the same time never share cookies, storage or a page.
- The user can watch any employee's tab live and take over with mouse and keyboard.
- Dev servers never outlive the task, the employee, the project or the app.
- Works on macOS, Windows and Linux; CI stays green on all three.

**Non-goals**
- Browsing the internet (only `localhost` / `127.0.0.1`).
- Firefox or WebKit.
- Mobile emulators (parts 2 and 3).
- A browser for the boss (it delegates checking to employees).
- Recording video of sessions.

## 3. Architecture

```
employee claude ──MCP (HTTP, per-agent token)──▶ main: EmployeeTools ──▶ BrowserService ──▶ Chromium (1 per project)
                                                         │                     │   └─ one BrowserContext + Page per employee
                                                         └──▶ DevServerService ─┴─▶ dev server child process per employee
renderer Preview tab ◀──IPC frames── BrowserService (CDP screencast of the watched page)
renderer Preview tab ──IPC input──▶ BrowserService (page.mouse / page.keyboard)
```

All of it lives in the main process, created by `ProjectService.open()` and shut down (awaited) by `ProjectService.close()` and app quit.

### 3.1 `BrowserService` (`src/main/browser/browserService.ts`)

- Depends on `playwright-core` (runtime dependency, pinned to the exact version of `@playwright/test` in `package.json`).
- `ensureBrowser()`: lazily launches Chromium, headless, once per project:
  1. `chromium.launch({ channel: 'chrome' })`, then `{ channel: 'msedge' }` (the user's installed browser);
  2. else Playwright's own Chromium if it was downloaded into `<userData>/browsers` (`PLAYWRIGHT_BROWSERS_PATH` set for the launch);
  3. else throws `BrowserMissing`, which tools and the Preview tab report as "No browser available. Download Chromium from the Preview tab."
- `downloadChromium()`: runs Playwright's installer for `chromium` into `<userData>/browsers`, reports progress to the Preview tab. Only ever started by the user's click.
- `pageFor(agentId)`: creates on first use a `BrowserContext` (fresh, in-memory profile; viewport 1280×800) and one `Page` for that employee; returns the same page afterwards. If the page was closed or crashed, a new one is made.
- `closeFor(agentId)`: closes that employee's context (on fire).
- `close()`: closes the browser and waits for the process to exit.
- Launch is shared: concurrent first calls wait on the same promise.

### 3.2 `DevServerService` (`src/main/browser/devServers.ts`)

- `start(agentId, cwd, command)`:
  - `command` is split into argv with a small quote-aware splitter (no shell): `npm run dev`, `pnpm dev --host 127.0.0.1`. Shell operators (`&&`, `|`, `;`, `>`, `<`, backticks, `$(`) are refused with "Use a package script for compound commands".
  - Picks a free port on 127.0.0.1, spawns with `cross-spawn` (detached on POSIX), `cwd` = the employee's worktree (decided in main from the agent id, never from the tool input), env = process env + `PORT`, `HOST=127.0.0.1`, `BROWSER=none`, `CI=1`.
  - Waits until `http://127.0.0.1:<port>/` answers any HTTP status, polling every 500 ms, up to 90 s. Returns `{ url, port }`.
  - If the process exits first or the wait times out: kills it and throws with the last 40 output lines.
  - A previous server for the same employee is stopped first (one per employee).
  - Some servers ignore `PORT`. The literal `{port}` anywhere in the command is replaced by the chosen port (`npm run dev -- --port {port}`), so the employee can pass it as a flag. If the port never answers, the error says the server may be ignoring `PORT` and suggests `{port}`.
- Keeps the last 200 lines of combined stdout/stderr per server (ANSI codes stripped).
- `logs(agentId)`, `stop(agentId)`, `stopAll()`; stopping uses `killTree` and waits for exit.
- `AgentManager` calls `stop(agentId)` (outside `run()`, not awaited inside it) when that employee's task leaves `working` for `review`, `needs_help`, `failed` or `cancelled`, and when the employee is fired.

### 3.3 Employee tool server

- A second `McpHost` per project, named `office`, serving `employeeTools` (§4). Same host code: `127.0.0.1`, random port, body cap, constant-time token compare.
- `McpHost` gains a token map: `addClient(agentId): string` returns a fresh token for that employee; every request is resolved to its `agentId`, and tools receive it. Unknown token → 401. Firing an employee revokes its token.
- Each employee gets `projects/<id>/mcp-<agentId>.json` (mode 0600) and launches with `--mcp-config <file> --strict-mcp-config` and `--allowedTools mcp__office` added to its role's tools.
- `test/fake-claude` currently treats "has `--mcp-config`" as "is the boss" (it never writes files then). That check changes to "has `--allowedTools mcp__agentoffice`".

## 4. Employee tools (`src/main/browser/employeeTools.ts`)

All take the calling `agentId` from the token. Every call is written to the agent log and shown in its activity like other tool use (the stream already reports MCP tool use).

| Tool | Input | Result |
| --- | --- | --- |
| `start_dev_server` | `command` (string ≤ 300; `{port}` is replaced by the chosen port) | `{ url, port }` or error with recent output |
| `dev_server_logs` | `lines?` (1–200, default 60) | text |
| `stop_dev_server` | — | `{ stopped: boolean }` |
| `browser_open` | `url` | `{ url, title, status }` |
| `browser_snapshot` | — | accessibility outline with `ref` ids (YAML-like text, ≤ 40 KB, cut with a note) |
| `browser_click` | `ref`, `double?` | `{ ok, url, title }` |
| `browser_type` | `ref`, `text` (≤ 5,000), `submit?` | `{ ok }` |
| `browser_press` | `key` (Playwright key name from a fixed list) | `{ ok }` |
| `browser_screenshot` | `full_page?` | MCP image content (PNG, viewport by default, ≤ 2 MB) |
| `browser_console` | — | last 50 console errors/warnings and failed requests since the last call |
| `browser_resize` | `width` (320–2560), `height` (320–1600) | `{ ok }` |

- **URL rule** (`allowedUrl`): `http:` or `https:` only, host exactly `localhost`, `127.0.0.1` or `[::1]`, any port. Anything else → error "Only local addresses (localhost / 127.0.0.1) can be opened". Pages that navigate or redirect elsewhere are blocked by a context-level route that aborts non-local requests for top-level navigation; sub-resources from other hosts (fonts, CDNs) are allowed so real apps render.
- **Refs**: `browser_snapshot` uses Playwright's `page.locator('body').ariaSnapshot()` style output; refs map to locators kept per page and are invalidated by the next snapshot or navigation (a stale ref → "Take a new browser_snapshot").
- Timeouts: navigation 30 s, actions 10 s.
- Employee prompt (`renderPrompt`, employee rules) gains: "To check UI work: `start_dev_server` with the project's dev command, `browser_open` the URL it returns, use `browser_snapshot`/`browser_click`/`browser_type` and `browser_screenshot` to verify, and say in your summary what you checked."
- A project setting **Browser for employees** (`Project.browserTools`, default `true`) leaves the tool server out of employee launches when off.

## 5. Preview tab

- `View` gains `{ name: 'preview' }`; the Header gets a **Preview** tab after History; it is remembered like the other tabs.
- `components/PreviewView.tsx`:
  - Employee picker (`<select>`, label "Employee"): employees that have a tab, plus a status line `Pixel · http://127.0.0.1:5174 · dev server running`.
  - A `<canvas>` showing the screencast (aspect kept, scaled to fit), with `tabIndex=0`, `aria-label="Live view of Pixel's browser tab"`.
  - Buttons: **Reload**, **Open in my browser** (`shell.openExternal`, local URLs only), **Stop dev server**.
  - Empty states: no browser → "No browser found" + **Download Chromium (~150 MB)** with progress; nobody has a tab → "An employee's tab appears here when it starts testing."
- Frames: `previewWatch(agentId | null)` starts/stops a CDP `Page.startScreencast` (JPEG, quality 70, max 1280×800, every frame acked) for that page only; frames go to the renderer as `preview-frame` events `{ agentId, data: base64, width, height }`, dropped while the previous frame is still unacked by the renderer (at most one in flight). Watching stops when the tab is left or the window is hidden.
- Input: `previewInput(agentId, event)` with `event` one of `{ kind: 'click', x, y, button }`, `{ kind: 'wheel', x, y, dy }`, `{ kind: 'key', key }`, `{ kind: 'text', text }`; `x`/`y` are 0–1 fractions of the frame, mapped to the page viewport. On the first input after 30 s of none, the employee's log gets "The user is using your browser tab." and, if the employee is mid-task, the same note is added to its next tool result.

## 6. IPC (sender-guarded, validated in `ipcArgs`-style helpers)

| Channel | Args | Result |
| --- | --- | --- |
| `preview:list` | — | `[{ agentId, url, title, devServer: { url, running } | null }]` |
| `preview:watch` | `agentId: string | null` | `void` |
| `preview:input` | `agentId`, event (zod schema above; text ≤ 1,000; key from the fixed list; x/y in [0,1]) | `void` |
| `preview:reload` / `preview:stopDevServer` | `agentId` | `void` |
| `preview:openExternal` | `agentId` | `void` (main reads the page URL; must pass `allowedUrl`) |
| `browser:download` | — | `void` (progress via `browser-download` events) |
| event `preview-frame` | — | frame |
| event `preview-changed` | — | tabs/dev servers changed (list again) |

All act on the open project; no project → `Open a project first`.

## 7. Security

- Employees reach only their own page and dev server (token → agent id; ids never come from tool input).
- Only local URLs can be opened or navigated to; the browser profile is in-memory per employee and never the user's real profile, even when the system Chrome binary is used.
- Dev server commands run without a shell, in the employee's worktree, with refused shell operators.
- The renderer can only watch, click, type, reload, stop and open local URLs externally; no IPC lets it run commands or open non-local URLs.
- No remote-debugging port is opened: Playwright talks to Chromium over its pipe, and the screencast uses the same CDP session.
- Agents have no channel to the Preview IPC.

## 8. Error handling

| Case | Behaviour |
| --- | --- |
| No browser installed | Tools fail with the "download from the Preview tab" message; the Preview tab shows the download button. |
| Download fails / offline | Error banner with the reason; button stays. |
| Dev server exits or never answers | Tool error with the last 40 output lines; process killed. |
| Port ignored by the dev server | Timeout error explains `PORT` and suggests the tool's port flag. |
| Page crashes / closed | Next call makes a new page; the tool result says the page was reloaded. |
| Employee fired | Context closed, dev server stopped, token revoked. |
| Project closed / app quits | Dev servers killed and awaited, browser closed and awaited, tool server closed. |
| Two employees at once | Separate contexts and pages; no lock needed. |

## 9. Testing

- Unit (pure): `allowedUrl`; command splitter and refused operators; free-port picker; token→agent map in `McpHost` (unknown token 401, revoke); input event schema; frame back-pressure.
- `devServers.test.ts`: a tiny Node server script as the "dev server": start → URL answers; logs kept and ANSI-stripped; early exit → error with output; stop and `stopAll` leave no process; restart replaces the old one.
- `browser.test.ts` (real headless Chromium; skipped when no browser can launch): open a local test page, snapshot has refs, click a button changes text, type + submit, screenshot is a PNG, console error reported, non-local URL refused, two agents don't share `localStorage`.
- Manager integration: an employee's dev server is stopped when its task goes to review and when it is fired; employee launch args contain `--mcp-config` + `mcp__office` only when `browserTools` is on.
- Fake CLI: new `FAKE_CLAUDE_MCP_CALLS` (JSON list of `{ tool, args }`) makes the fake call those tools over the MCP config before replying, so integration and e2e tests can drive the browser tools.
- e2e: an employee (fake CLI) starts a dev server from a fixture repo, opens it; the Preview tab shows the employee in the picker and a frame on the canvas; a click is delivered.
- CI: add `npx playwright install chromium` (with `--with-deps` on Linux) so the browser tests run on all three OSes.
- Gates: `npm run typecheck && npm test && npm run test:e2e`; screenshot the Preview tab.
