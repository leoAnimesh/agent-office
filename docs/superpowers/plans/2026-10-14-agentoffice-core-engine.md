# AgentOffice Core Engine — Implementation Plan (Plan 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A cross-platform Electron app skeleton plus a fully tested core engine that can hire employee agents, give them tasks, run each task as a real `claude` CLI session in its own git worktree, track live status, and record results.

**Architecture:** Everything runs in the Electron main process as plain TypeScript modules with injected dependencies, so they're testable in Vitest without Electron. `ClaudeRunner` wraps one `claude -p --input-format stream-json --output-format stream-json` child process; `AgentManager` orchestrates runners, `WorktreeManager` (git) and JSON stores. Tests drive the real code against a fake `claude` Node script and temporary git repos.

**Tech Stack:** Electron + electron-vite, React 18, TypeScript (strict), Vitest, cross-spawn, Node 22, git ≥ 2.28.

**Spec:** `docs/superpowers/specs/2026-10-14-agentoffice-design.md`

**Later plans:** Plan 2 — MCP host, Boss session and Boss chat (spec §6, milestone 4). Plan 3 — office UI, task board, team/role editor, onboarding, settings, merge approvals, packaging (milestones 5–6).

## Global Constraints

- Cross-platform: macOS, Windows and Linux are all first-class; CI matrix `ubuntu-latest`, `macos-latest`, `windows-latest` must stay green.
- Spawn processes with an args array via `cross-spawn`, never a shell string. Long prompts go through `--append-system-prompt-file`, not argv.
- All paths built with `node:path`; never hard-code `/` or `~`. App data lives under Electron `app.getPath('userData')` (the engine receives the directory as a parameter).
- POSIX children spawn with `detached: true` and are killed with `process.kill(-pid)`; Windows uses `taskkill /pid <pid> /T /F`.
- Stream parsing tolerates `\r\n` and partial lines.
- Agent sessions run with `--setting-sources project,local` by default (keeps the user's global hooks/plugins out).
- Renderer: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, strict CSP.
- Git commits in this repo: author `leoAnimesh <mondalarup808@gmail.com>` (already set repo-locally); end messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- TypeScript strict; no `any` in exported signatures.

## Review Focus

1. **Paths with spaces** (e.g. `C:\Program Files\nodejs\node.exe`, `~/Library/Application Support/…`) for the CLI binary and the repo → spawning and git still work. Test: Task 6 runs the fake CLI from a directory containing a space.
2. **Messy stdout** — chunks split mid-line, `\r\n`, a non-JSON line, unknown event types → the parser never throws and keeps later events. Test: Task 4.
3. **Odd agent names** (`"Dr. Who/QA"`, `"Zoë"`, `"   "`, emoji) → safe branch and worktree names, never empty, never path traversal. Test: Task 7.
4. **The CLI crashing or exiting before a result** → task becomes `needs_help` with the stderr tail, the agent is freed, and the next queued task still runs. Test: Task 9.
5. **Restart with tasks left `working`** (app killed mid-task) → on load they're `queued` again and run exactly once. Test: Task 9.

---

## File Structure

```
package.json                      scripts, deps, "main": "./out/main/index.js"
electron.vite.config.ts           main/preload/renderer build config
tsconfig.json                     node-side typecheck (main, preload, shared, tests)
tsconfig.web.json                 renderer typecheck
vitest.config.ts                  test config
.github/workflows/ci.yml          OS matrix: typecheck, test, build
LICENSE, README.md

src/shared/types.ts               domain types (Role, Skill, Agent, Task, Project, RunnerEvent, AppStatus)
src/shared/ipc.ts                 IPC channel names + AgentOfficeApi interface

src/main/index.ts                 Electron entry: window, IPC handlers
src/main/appStatus.ts             CLI detection result for the UI
src/main/store/jsonStore.ts       readJson / writeJsonAtomic / appendJsonl / copyMissingFiles
src/main/store/paths.ts           dataPaths(root)
src/main/store/projectStore.ts    projects, agents, tasks, logs on disk; nextTaskId
src/main/store/roleStore.ts       role templates
src/main/store/skillStore.ts      skill markdown files (front-matter)
src/main/agents/prompt.ts         renderPrompt(role, skills, ctx), taskMessage(task)
src/main/agents/taskRules.ts      status transitions + runnableTasks()
src/main/agents/agentManager.ts   orchestration
src/main/claude/streamParser.ts   LineSplitter + parseLine()
src/main/claude/status.ts         describeTool() + reduceStatus()
src/main/claude/locate.ts         candidatePaths(), locateClaude(), claudeVersion()
src/main/claude/shellPath.ts      login-shell PATH merge for GUI launches
src/main/claude/args.ts           buildClaudeArgs(), userMessageLine()
src/main/claude/killTree.ts       cross-platform process-tree kill
src/main/claude/runner.ts         AgentRunner interface + ClaudeRunner
src/main/git/worktrees.ts         git(), slugify(), inspectRepo(), WorktreeManager, parseNumstat()

src/preload/index.ts              contextBridge API
src/renderer/index.html, src/renderer/src/{main.tsx,App.tsx,env.d.ts,styles.css}

resources/roles/*.json            built-in role templates
resources/skills/*.md             built-in skills

test/fake-claude/fake-claude.mjs  scripted stand-in for the claude CLI
test/fixtures/stream/read-file.jsonl   real stream-json sample (sanitized)
test/helpers/repo.ts              makeRepo() temp git repo
test/helpers/runner.ts            fakeRunner(), waitForEvent()
(unit tests sit next to their module as *.test.ts; integration tests in test/*.test.ts)
```

---

### Task 1: Scaffold the Electron app, tooling and CI

**Files:**
- Create: `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `tsconfig.web.json`, `vitest.config.ts`, `.github/workflows/ci.yml`, `LICENSE`, `README.md`
- Create: `src/main/index.ts`, `src/preload/index.ts`, `src/shared/ipc.ts`, `src/renderer/index.html`, `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/env.d.ts`, `src/renderer/src/styles.css`
- Test: `src/shared/ipc.test.ts`

**Interfaces:**
- Produces: `IPC` constant object and `AgentOfficeApi` interface in `src/shared/ipc.ts` (extended in Task 10); npm scripts `dev`, `build`, `typecheck`, `test`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "agent-office",
  "version": "0.1.0",
  "description": "A pixel-art office where a boss Claude Code agent hires and delegates to a team of specialist agents.",
  "main": "./out/main/index.js",
  "author": "leoAnimesh <mondalarup808@gmail.com>",
  "license": "MIT",
  "repository": "github:leoAnimesh/agent-office",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "typecheck": "tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.web.json",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run:
```bash
npm install cross-spawn react react-dom
npm install -D electron electron-vite vite @vitejs/plugin-react typescript vitest @types/node @types/react @types/react-dom @types/cross-spawn
```
Expected: installs without peer-dependency errors. If npm reports an `electron-vite` ↔ `vite` peer conflict, install the `vite` major that `npm view electron-vite peerDependencies` lists (e.g. `npm install -D vite@<major>`).

- [ ] **Step 3: Create build and type configs**

`electron.vite.config.ts`:
```ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: { plugins: [react()] },
});
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "types": ["node"],
    "noEmit": true
  },
  "include": ["electron.vite.config.ts", "vitest.config.ts", "src/main/**/*", "src/preload/**/*", "src/shared/**/*", "test/**/*.ts"]
}
```

`tsconfig.web.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["src/renderer/src/**/*", "src/shared/**/*"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
```

- [ ] **Step 4: Write the failing test** — `src/shared/ipc.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { IPC } from './ipc';

describe('IPC channels', () => {
  it('uses unique, namespaced channel names', () => {
    const names = Object.values(IPC);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[a-z]+:[a-z-]+$/);
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `npx vitest run src/shared/ipc.test.ts`
Expected: FAIL — cannot resolve `./ipc`.

- [ ] **Step 6: Create the app files**

`src/shared/ipc.ts`:
```ts
export const IPC = {
  appStatus: 'app:status',
} as const;

export interface AgentOfficeApi {
  getStatus(): Promise<unknown>;
}
```

`src/main/index.ts`:
```ts
import { app, BrowserWindow } from 'electron';
import path from 'node:path';

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#14151F',
    title: 'AgentOffice',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

`src/preload/index.ts`:
```ts
import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type AgentOfficeApi } from '../shared/ipc';

const api: AgentOfficeApi = {
  getStatus: () => ipcRenderer.invoke(IPC.appStatus),
};

contextBridge.exposeInMainWorld('agentOffice', api);
```

`src/renderer/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'" />
    <title>AgentOffice</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./src/main.tsx"></script>
  </body>
</html>
```

`src/renderer/src/env.d.ts`:
```ts
import type { AgentOfficeApi } from '../../shared/ipc';

declare global {
  interface Window {
    agentOffice: AgentOfficeApi;
  }
}
export {};
```

`src/renderer/src/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`src/renderer/src/App.tsx`:
```tsx
export function App() {
  return (
    <main className="boot">
      <h1>AgentOffice</h1>
      <p>Setting up the office…</p>
    </main>
  );
}
```

`src/renderer/src/styles.css`:
```css
:root { color-scheme: dark; }
body { margin: 0; background: #14151f; color: #ece8df; font-family: system-ui, sans-serif; }
.boot { padding: 48px; }
.boot h1 { margin: 0 0 8px; }
```

- [ ] **Step 7: Run the test, typecheck and build**

Run: `npx vitest run src/shared/ipc.test.ts && npm run typecheck && npm run build`
Expected: test PASS; typecheck exits 0; build writes `out/main/index.js`, `out/preload/index.js`, `out/renderer/index.html`.

- [ ] **Step 8: Add CI, license and README**

`.github/workflows/ci.yml`:
```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
jobs:
  test:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
```

`LICENSE`: the standard MIT license text with `Copyright (c) 2026 leoAnimesh`.

`README.md`:
```markdown
# AgentOffice

A desktop app where a **boss** Claude Code agent hires a team of specialist agents (frontend, backend, QA, …), hands out tasks, and reviews their work, all shown as a pixel-art office.

> Status: early development. Runs on macOS, Windows and Linux.

## Requirements
- [Claude Code](https://docs.claude.com/en/docs/claude-code) installed and signed in (`claude --version` works)
- git ≥ 2.28, Node.js 22 (for development)

## Develop
    npm install
    npm run dev       # launch the app
    npm test          # unit + integration tests (uses a fake claude CLI)

## Safety
Each agent works in its own git worktree, but agents run with your user's permissions. Staying inside the worktree is an instruction to the agent, not a sandbox.

## License
MIT
```

- [ ] **Step 9: Manually confirm the window opens**

Run: `npm run dev`
Expected: a dark window titled "AgentOffice" shows "Setting up the office…". Close it.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: scaffold Electron + React + TypeScript app with CI matrix

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Domain types, JSON storage and ProjectStore

**Files:**
- Create: `src/shared/types.ts`, `src/main/store/jsonStore.ts`, `src/main/store/paths.ts`, `src/main/store/projectStore.ts`
- Test: `src/main/store/jsonStore.test.ts`, `src/main/store/projectStore.test.ts`

**Interfaces:**
- Produces (used by every later task):

```ts
// src/shared/types.ts
export type AgentStatus = 'idle' | 'thinking' | 'working' | 'waiting' | 'done' | 'error' | 'paused';
export type TaskStatus = 'queued' | 'working' | 'needs_help' | 'review' | 'done' | 'failed' | 'cancelled';
export type PermissionMode = 'acceptEdits' | 'default' | 'plan' | 'bypassPermissions';
export interface Look { hair: string; shirt: string; skin: string }
export interface Role { id: string; name: string; blurb: string; systemPrompt: string; skills: string[]; model: string; permissionMode: PermissionMode; allowedTools: string[]; look: Look }
export interface Skill { id: string; name: string; description: string; body: string }
export interface Agent { id: string; projectId: string; name: string; roleId: string; kind: 'boss' | 'employee'; sessionId?: string; worktreePath?: string; status: AgentStatus; bubble: string }
export interface DiffStat { path: string; add: number; del: number }
export interface Task { id: string; projectId: string; title: string; brief: string; assigneeId: string; createdBy: 'boss' | 'user'; status: TaskStatus; held: boolean; attempts: number; branch: string; dependsOn: string[]; resultSummary?: string; diffStat?: DiffStat[]; createdAt: string; updatedAt: string }
export interface Project { id: string; name: string; repoPath: string; baseBranch: string; bossId?: string; maxConcurrent: number; bossCanHire: boolean; autoMerge: boolean }
export type RunnerEvent = …   // see Step 3
export interface AppStatus { platform: string; claude: { path: string; version: string | null } | null }
```
- `readJson<T>(file, fallback): Promise<T>`, `writeJsonAtomic(file, data): Promise<void>`, `appendJsonl(file, obj): Promise<void>`, `readJsonl(file, limit): Promise<unknown[]>`, `copyMissingFiles(fromDir, toDir): Promise<number>`
- `dataPaths(root): DataPaths`
- `class ProjectStore { listProjects; getProject; saveProject; getAgents; saveAgents; getTasks; saveTasks; appendLog; readLog }`, `nextTaskId(tasks): string`

- [ ] **Step 1: Write the failing tests**

`src/main/store/jsonStore.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendJsonl, copyMissingFiles, readJson, readJsonl, writeJsonAtomic } from './jsonStore';

let dir: string;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-json-')); });
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

describe('jsonStore', () => {
  it('returns the fallback when the file does not exist', async () => {
    expect(await readJson(path.join(dir, 'missing.json'), { a: 1 })).toEqual({ a: 1 });
  });

  it('writes atomically into nested folders and reads back', async () => {
    const file = path.join(dir, 'a', 'b', 'data.json');
    await writeJsonAtomic(file, { hello: 'world' });
    expect(await readJson(file, null)).toEqual({ hello: 'world' });
    const leftovers = (await fs.readdir(path.dirname(file))).filter((f) => f.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('names the file when JSON is corrupt', async () => {
    const file = path.join(dir, 'bad.json');
    await fs.writeFile(file, '{ nope');
    await expect(readJson(file, null)).rejects.toThrow(/Corrupt JSON in .*bad\.json/);
  });

  it('survives many concurrent writes to the same file', async () => {
    const file = path.join(dir, 'race.json');
    await Promise.all(Array.from({ length: 20 }, (_, i) => writeJsonAtomic(file, { i })));
    const v = await readJson<{ i: number }>(file, { i: -1 });
    expect(v.i).toBeGreaterThanOrEqual(0);
  });

  it('appends and reads JSON lines, keeping the last N', async () => {
    const file = path.join(dir, 'log.jsonl');
    for (let i = 0; i < 5; i++) await appendJsonl(file, { i });
    expect(await readJsonl(file, 2)).toEqual([{ i: 3 }, { i: 4 }]);
    expect(await readJsonl(path.join(dir, 'none.jsonl'), 10)).toEqual([]);
  });

  it('copies only files missing in the target', async () => {
    const from = path.join(dir, 'from');
    const to = path.join(dir, 'to');
    await fs.mkdir(from);
    await fs.mkdir(to);
    await fs.writeFile(path.join(from, 'a.json'), 'new-a');
    await fs.writeFile(path.join(from, 'b.json'), 'new-b');
    await fs.writeFile(path.join(to, 'a.json'), 'user-edited');
    expect(await copyMissingFiles(from, to)).toBe(1);
    expect(await fs.readFile(path.join(to, 'a.json'), 'utf8')).toBe('user-edited');
    expect(await fs.readFile(path.join(to, 'b.json'), 'utf8')).toBe('new-b');
  });
});
```

`src/main/store/projectStore.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dataPaths } from './paths';
import { ProjectStore, nextTaskId } from './projectStore';
import type { Project, Task } from '../../shared/types';

let root: string;
let store: ProjectStore;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-data-'));
  store = new ProjectStore(dataPaths(root));
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

const project: Project = { id: 'p1', name: 'demo', repoPath: '/tmp/demo', baseBranch: 'main', maxConcurrent: 4, bossCanHire: true, autoMerge: false };

describe('ProjectStore', () => {
  it('lists nothing before any project exists', async () => {
    expect(await store.listProjects()).toEqual([]);
  });

  it('saves and lists projects, agents and tasks', async () => {
    await store.saveProject(project);
    expect(await store.listProjects()).toEqual([project]);
    expect(await store.getAgents('p1')).toEqual([]);
    await store.saveTasks('p1', [{ id: 'T-101' } as Task]);
    expect((await store.getTasks('p1'))[0].id).toBe('T-101');
  });

  it('appends and reads agent logs', async () => {
    await store.appendLog('p1', 'a1', { n: 1 });
    await store.appendLog('p1', 'a1', { n: 2 });
    expect(await store.readLog('p1', 'a1')).toEqual([{ n: 1 }, { n: 2 }]);
  });
});

describe('nextTaskId', () => {
  it('starts at T-101 and increments past the highest id', () => {
    expect(nextTaskId([])).toBe('T-101');
    expect(nextTaskId([{ id: 'T-101' }, { id: 'T-107' }, { id: 'T-103' }] as Task[])).toBe('T-108');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/main/store`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `src/shared/types.ts`**

```ts
export type AgentStatus = 'idle' | 'thinking' | 'working' | 'waiting' | 'done' | 'error' | 'paused';
export type TaskStatus = 'queued' | 'working' | 'needs_help' | 'review' | 'done' | 'failed' | 'cancelled';
export type PermissionMode = 'acceptEdits' | 'default' | 'plan' | 'bypassPermissions';

export interface Look { hair: string; shirt: string; skin: string }

export interface Role {
  id: string;
  name: string;
  blurb: string;
  systemPrompt: string;
  skills: string[];
  model: string;
  permissionMode: PermissionMode;
  allowedTools: string[];
  look: Look;
}

export interface Skill { id: string; name: string; description: string; body: string }

export interface Agent {
  id: string;
  projectId: string;
  name: string;
  roleId: string;
  kind: 'boss' | 'employee';
  sessionId?: string;
  worktreePath?: string;
  status: AgentStatus;
  bubble: string;
}

export interface DiffStat { path: string; add: number; del: number }

export interface Task {
  id: string;
  projectId: string;
  title: string;
  brief: string;
  assigneeId: string;
  createdBy: 'boss' | 'user';
  status: TaskStatus;
  /** Paused by the user: stays queued until resumed. */
  held: boolean;
  /** How many times a session was started for this task. */
  attempts: number;
  branch: string;
  dependsOn: string[];
  resultSummary?: string;
  diffStat?: DiffStat[];
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  repoPath: string;
  baseBranch: string;
  bossId?: string;
  maxConcurrent: number;
  bossCanHire: boolean;
  autoMerge: boolean;
}

export type RunnerEvent =
  | { type: 'init'; sessionId: string; model: string }
  | { type: 'thinking' }
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; isError: boolean; preview: string }
  | { type: 'result'; ok: boolean; text: string; sessionId: string; costUsd: number; durationMs: number; numTurns: number }
  | { type: 'raw'; text: string }
  | { type: 'stderr'; text: string }
  | { type: 'exit'; code: number | null; signal: string | null };

export interface AppStatus {
  platform: string;
  claude: { path: string; version: string | null } | null;
}
```

- [ ] **Step 4: Write `src/main/store/jsonStore.ts`**

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw err;
  }
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new Error(`Corrupt JSON in ${file}: ${(err as Error).message}`);
  }
}

let counter = 0;

export async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${counter++}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  try {
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

export async function appendJsonl(file: string, obj: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, JSON.stringify(obj) + '\n', 'utf8');
}

export async function readJsonl(file: string, limit: number): Promise<unknown[]> {
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const out: unknown[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip a torn last line */ }
  }
  return out.slice(-limit);
}

export async function copyMissingFiles(fromDir: string, toDir: string): Promise<number> {
  await fs.mkdir(toDir, { recursive: true });
  let copied = 0;
  for (const name of await fs.readdir(fromDir)) {
    const target = path.join(toDir, name);
    try {
      await fs.copyFile(path.join(fromDir, name), target, fs.constants.COPYFILE_EXCL);
      copied++;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
  return copied;
}
```

Note for Windows: if the concurrent-write test fails there with `EPERM` on `rename`, wrap the rename in a retry of up to 5 attempts with a 20 ms wait on `EPERM`/`EBUSY`.

- [ ] **Step 5: Write `src/main/store/paths.ts`**

```ts
import path from 'node:path';

export interface DataPaths {
  root: string;
  settingsFile: string;
  rolesDir: string;
  skillsDir: string;
  projectsDir: string;
  promptDir: string;
  projectDir(projectId: string): string;
  projectFile(projectId: string): string;
  agentsFile(projectId: string): string;
  tasksFile(projectId: string): string;
  chatFile(projectId: string): string;
  logFile(projectId: string, agentId: string): string;
}

export function dataPaths(root: string): DataPaths {
  const projectsDir = path.join(root, 'projects');
  const projectDir = (id: string) => path.join(projectsDir, id);
  return {
    root,
    settingsFile: path.join(root, 'settings.json'),
    rolesDir: path.join(root, 'roles'),
    skillsDir: path.join(root, 'skills'),
    projectsDir,
    promptDir: path.join(root, 'prompts'),
    projectDir,
    projectFile: (id) => path.join(projectDir(id), 'project.json'),
    agentsFile: (id) => path.join(projectDir(id), 'agents.json'),
    tasksFile: (id) => path.join(projectDir(id), 'tasks.json'),
    chatFile: (id) => path.join(projectDir(id), 'chat.jsonl'),
    logFile: (id, agentId) => path.join(projectDir(id), 'logs', `${agentId}.jsonl`),
  };
}
```

- [ ] **Step 6: Write `src/main/store/projectStore.ts`**

```ts
import { promises as fs } from 'node:fs';
import type { Agent, Project, Task } from '../../shared/types';
import { appendJsonl, readJson, readJsonl, writeJsonAtomic } from './jsonStore';
import type { DataPaths } from './paths';

export class ProjectStore {
  constructor(private readonly paths: DataPaths) {}

  async listProjects(): Promise<Project[]> {
    let ids: string[];
    try {
      ids = await fs.readdir(this.paths.projectsDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const projects = await Promise.all(ids.map((id) => this.getProject(id)));
    return projects.filter((p): p is Project => p !== null);
  }

  getProject(id: string): Promise<Project | null> {
    return readJson<Project | null>(this.paths.projectFile(id), null);
  }

  saveProject(project: Project): Promise<void> {
    return writeJsonAtomic(this.paths.projectFile(project.id), project);
  }

  getAgents(projectId: string): Promise<Agent[]> {
    return readJson<Agent[]>(this.paths.agentsFile(projectId), []);
  }

  saveAgents(projectId: string, agents: Agent[]): Promise<void> {
    return writeJsonAtomic(this.paths.agentsFile(projectId), agents);
  }

  getTasks(projectId: string): Promise<Task[]> {
    return readJson<Task[]>(this.paths.tasksFile(projectId), []);
  }

  saveTasks(projectId: string, tasks: Task[]): Promise<void> {
    return writeJsonAtomic(this.paths.tasksFile(projectId), tasks);
  }

  appendLog(projectId: string, agentId: string, entry: unknown): Promise<void> {
    return appendJsonl(this.paths.logFile(projectId, agentId), entry);
  }

  readLog(projectId: string, agentId: string, limit = 500): Promise<unknown[]> {
    return readJsonl(this.paths.logFile(projectId, agentId), limit);
  }
}

export function nextTaskId(tasks: Pick<Task, 'id'>[]): string {
  const max = tasks.reduce((m, t) => Math.max(m, Number(t.id.replace(/^T-/, '')) || 0), 100);
  return `T-${max + 1}`;
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/main/store && npm run typecheck`
Expected: all PASS; typecheck exits 0.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(store): domain types, atomic JSON storage and ProjectStore

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Role and skill stores, built-in presets, prompt rendering

**Files:**
- Create: `src/main/store/roleStore.ts`, `src/main/store/skillStore.ts`, `src/main/agents/prompt.ts`
- Create: `resources/roles/{boss,frontend,backend,qa,designer,devops,writer,security}.json`
- Create: `resources/skills/{react-patterns,a11y-checklist,testing-basics,api-design,git-hygiene,docs-style}.md`
- Test: `src/main/store/roleStore.test.ts`, `src/main/store/skillStore.test.ts`, `src/main/agents/prompt.test.ts`

**Interfaces:**
- Consumes: `Role`, `Skill`, `Task` (Task 2); `readJson`, `writeJsonAtomic`, `copyMissingFiles` (Task 2).
- Produces:
  - `class RoleStore(dir) { list(): Promise<Role[]>; get(id): Promise<Role | null>; save(role): Promise<void>; seed(fromDir): Promise<number> }`
  - `parseSkill(id, raw): Skill`; `class SkillStore(dir) { list(); get(id); getMany(ids): Promise<Skill[]>; seed(fromDir) }`
  - `interface PromptContext { agentName: string; bossName: string; branch: string; projectName: string; kind: 'boss' | 'employee' }`
  - `renderPrompt(role, skills, ctx): string`; `taskMessage(task): string`

- [ ] **Step 1: Create the built-in roles**

`resources/roles/frontend.json`:
```json
{
  "id": "frontend",
  "name": "Frontend Engineer",
  "blurb": "React, CSS, accessibility",
  "systemPrompt": "You are a senior frontend engineer. Prefer small, typed components and accessible markup. Match the existing code style of the project.",
  "skills": ["react-patterns", "a11y-checklist", "testing-basics", "git-hygiene"],
  "model": "sonnet",
  "permissionMode": "acceptEdits",
  "allowedTools": ["Read", "Edit", "Write", "Bash", "Grep", "Glob"],
  "look": { "hair": "#E2583E", "shirt": "#2F9E8F", "skin": "#F1C9A5" }
}
```

Create the other seven roles with the same shape. Use these exact values:

| file | id | name | blurb | model | permissionMode | allowedTools | skills | look (hair, shirt, skin) |
|---|---|---|---|---|---|---|---|---|
| boss.json | boss | Boss | Plans, delegates, reviews | opus | default | Read, Grep, Glob | git-hygiene | #3B2A20, #2B3350, #E8B48A |
| backend.json | backend | Backend Engineer | APIs, data, auth | sonnet | acceptEdits | Read, Edit, Write, Bash, Grep, Glob | api-design, testing-basics, git-hygiene | #1F1B2E, #5B6CD6, #B9825C |
| qa.json | qa | QA Engineer | Tests, repro, E2E | haiku | acceptEdits | Read, Edit, Write, Bash, Grep, Glob | testing-basics, git-hygiene | #D9B44A, #8A5BD6, #F5D6BC |
| designer.json | designer | Product Designer | Tokens, UI copy | sonnet | acceptEdits | Read, Edit, Write, Grep, Glob | a11y-checklist, git-hygiene | #2E5E3A, #D6658A, #8D5B3E |
| devops.json | devops | DevOps | CI, builds, deploys | haiku | acceptEdits | Read, Edit, Write, Bash, Grep, Glob | git-hygiene | #6B6F80, #C9733A, #E3B08A |
| writer.json | writer | Tech Writer | Docs, changelogs | haiku | acceptEdits | Read, Edit, Write, Grep, Glob | docs-style, git-hygiene | #8A4B2A, #3E8E5A, #F1C9A5 |
| security.json | security | Security Reviewer | Audits, threat model | sonnet | default | Read, Grep, Glob | git-hygiene | #14151F, #B23A48, #C68C64 |

System prompts:
- boss: "You lead a small team of AI engineers. Break the user's request into small, independent tasks, give each to the best-suited teammate, review what comes back, and keep the user informed. Do not write code yourself."
- backend: "You are a senior backend engineer. Design clear APIs, validate inputs at the boundary, and keep data changes backwards compatible."
- qa: "You are a QA engineer. Reproduce issues before fixing them, write focused automated tests, and report exactly what you verified."
- designer: "You are a product designer who codes. Work on design tokens, styles and UI copy. Keep contrast at WCAG AA or better."
- devops: "You are a DevOps engineer. Keep CI fast and deterministic, pin tool versions, and never commit secrets."
- writer: "You are a technical writer. Write short, concrete docs with runnable examples."
- security: "You are a security reviewer. Read the code, find concrete vulnerabilities, and report them with file and line. Do not modify files."

- [ ] **Step 2: Create the built-in skills**

Each file has front-matter and a short body. `resources/skills/react-patterns.md`:
```markdown
---
name: React patterns
description: Component and hook conventions
---
- One component per file; name the file after the component.
- Keep state as close to where it is used as possible; lift it only when two siblings need it.
- Derive values during render instead of syncing them with effects.
- Every interactive element is a real `<button>`, `<a href>` or form control.
```

The other five, same format:
- `a11y-checklist.md` — name "Accessibility checklist", description "WCAG AA checks". Body: text contrast ≥ 4.5:1; every input has a label; icon-only buttons have `aria-label`; everything works with the keyboard alone; respect `prefers-reduced-motion`.
- `testing-basics.md` — name "Testing basics", description "How to test changes". Body: find and run the project's existing test command first; add a test that fails without your change; keep tests independent of order and the network; report the exact command you ran and its result.
- `api-design.md` — name "API design", description "HTTP/JSON API conventions". Body: validate input at the edge and return 400 with a field-level message; never leak stack traces; use plural resource names; version breaking changes.
- `git-hygiene.md` — name "Git hygiene", description "Commits and branches". Body: commit in small logical steps with imperative messages; never rewrite history on shared branches; never commit secrets, `.env` files or build output; stay on the branch you were given.
- `docs-style.md` — name "Docs style", description "How to write docs here". Body: lead with what the reader can do; use second person and present tense; every command in a code block; keep paragraphs to three sentences.

- [ ] **Step 3: Write the failing tests**

`src/main/store/roleStore.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RoleStore } from './roleStore';

let dir: string;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-roles-')); });
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

describe('RoleStore', () => {
  it('seeds the built-in roles and lists them sorted by name', async () => {
    const store = new RoleStore(dir);
    expect(await store.seed(path.resolve('resources/roles'))).toBe(8);
    const roles = await store.list();
    expect(roles.map((r) => r.id)).toContain('frontend');
    expect(roles.map((r) => r.name)).toEqual([...roles.map((r) => r.name)].sort());
    for (const r of roles) {
      expect(r.allowedTools.length).toBeGreaterThan(0);
      expect(r.look.shirt).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('keeps user edits when seeding again', async () => {
    const store = new RoleStore(dir);
    await store.seed(path.resolve('resources/roles'));
    const fe = (await store.get('frontend'))!;
    await store.save({ ...fe, model: 'opus' });
    expect(await store.seed(path.resolve('resources/roles'))).toBe(0);
    expect((await store.get('frontend'))!.model).toBe('opus');
  });

  it('rejects unsafe role ids', async () => {
    const store = new RoleStore(dir);
    const fe = { id: '../evil', name: 'x', blurb: '', systemPrompt: '', skills: [], model: 'sonnet', permissionMode: 'default' as const, allowedTools: ['Read'], look: { hair: '#000000', shirt: '#000000', skin: '#000000' } };
    await expect(store.save(fe)).rejects.toThrow(/Invalid role id/);
  });

  it('returns null for an unknown role', async () => {
    expect(await new RoleStore(dir).get('nope')).toBeNull();
  });
});
```

`src/main/store/skillStore.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SkillStore, parseSkill } from './skillStore';

describe('parseSkill', () => {
  it('reads front-matter and body, with CRLF line endings too', () => {
    const s = parseSkill('x', '---\r\nname: X skill\r\ndescription: Does x\r\n---\r\nBody line\r\n');
    expect(s).toEqual({ id: 'x', name: 'X skill', description: 'Does x', body: 'Body line' });
  });

  it('falls back to the id when there is no front-matter', () => {
    expect(parseSkill('plain', 'Just text')).toEqual({ id: 'plain', name: 'plain', description: '', body: 'Just text' });
  });
});

describe('SkillStore', () => {
  let dir: string;
  beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-skills-')); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('seeds built-ins and fetches several, skipping missing ids', async () => {
    const store = new SkillStore(dir);
    expect(await store.seed(path.resolve('resources/skills'))).toBe(6);
    const got = await store.getMany(['react-patterns', 'does-not-exist', 'git-hygiene']);
    expect(got.map((s) => s.id)).toEqual(['react-patterns', 'git-hygiene']);
    expect(got[0].name).toBe('React patterns');
  });
});
```

`src/main/agents/prompt.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { renderPrompt, taskMessage } from './prompt';
import type { Role, Task } from '../../shared/types';

const role: Role = { id: 'frontend', name: 'Frontend Engineer', blurb: '', systemPrompt: 'Be a great FE.', skills: ['react-patterns'], model: 'sonnet', permissionMode: 'acceptEdits', allowedTools: ['Read'], look: { hair: '#000000', shirt: '#000000', skin: '#000000' } };

describe('renderPrompt', () => {
  it('includes identity, role prompt, skills and rules in order', () => {
    const out = renderPrompt(role, [{ id: 'react-patterns', name: 'React patterns', description: 'd', body: 'Use hooks.' }], {
      agentName: 'Pixel', bossName: 'Max', branch: 'ao/pixel/x', projectName: 'demo', kind: 'employee',
    });
    expect(out).toContain('You are Pixel, the Frontend Engineer on the "demo" team. Your boss is Max.');
    const order = ['Be a great FE.', '## Skills', '### React patterns', 'Use hooks.', '## Rules', 'ao/pixel/x'];
    let last = -1;
    for (const s of order) {
      const i = out.indexOf(s);
      expect(i, s).toBeGreaterThan(last);
      last = i;
    }
  });

  it('omits the skills section when there are none', () => {
    const out = renderPrompt(role, [], { agentName: 'Pixel', bossName: 'Max', branch: 'b', projectName: 'demo', kind: 'employee' });
    expect(out).not.toContain('## Skills');
  });
});

describe('taskMessage', () => {
  const task = { id: 'T-101', title: 'Add toggle', brief: 'Make a toggle.', attempts: 0 } as Task;
  it('sends the full brief on the first attempt', () => {
    expect(taskMessage(task)).toBe('# Task T-101: Add toggle\n\nMake a toggle.\n\nWhen you are finished, reply with a short summary (at most 5 lines) of what you changed and how you verified it.');
  });
  it('asks to continue on later attempts', () => {
    expect(taskMessage({ ...task, attempts: 2 })).toMatch(/^Continue working on task T-101 \("Add toggle"\)/);
  });
});
```

- [ ] **Step 4: Run them to verify they fail**

Run: `npx vitest run src/main/store/roleStore.test.ts src/main/store/skillStore.test.ts src/main/agents/prompt.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 5: Write `src/main/store/roleStore.ts`**

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Role } from '../../shared/types';
import { copyMissingFiles, readJson, writeJsonAtomic } from './jsonStore';

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export class RoleStore {
  constructor(private readonly dir: string) {}

  async list(): Promise<Role[]> {
    let files: string[];
    try {
      files = (await fs.readdir(this.dir)).filter((f) => f.endsWith('.json'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const roles = await Promise.all(files.map((f) => readJson<Role | null>(path.join(this.dir, f), null)));
    return roles.filter((r): r is Role => r !== null).sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(id: string): Promise<Role | null> {
    if (!ID.test(id)) return null;
    return readJson<Role | null>(path.join(this.dir, `${id}.json`), null);
  }

  async save(role: Role): Promise<void> {
    if (!ID.test(role.id)) throw new Error(`Invalid role id: ${role.id}`);
    await writeJsonAtomic(path.join(this.dir, `${role.id}.json`), role);
  }

  seed(fromDir: string): Promise<number> {
    return copyMissingFiles(fromDir, this.dir);
  }
}
```

- [ ] **Step 6: Write `src/main/store/skillStore.ts`**

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Skill } from '../../shared/types';
import { copyMissingFiles } from './jsonStore';

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function parseSkill(id: string, raw: string): Skill {
  const text = raw.replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!m) return { id, name: id, description: '', body: text.trim() };
  const meta: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { id, name: meta.name || id, description: meta.description ?? '', body: m[2].trim() };
}

export class SkillStore {
  constructor(private readonly dir: string) {}

  async list(): Promise<Skill[]> {
    let files: string[];
    try {
      files = (await fs.readdir(this.dir)).filter((f) => f.endsWith('.md'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const skills = await Promise.all(files.map((f) => this.get(f.slice(0, -3))));
    return skills.filter((s): s is Skill => s !== null).sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(id: string): Promise<Skill | null> {
    if (!ID.test(id)) return null;
    try {
      return parseSkill(id, await fs.readFile(path.join(this.dir, `${id}.md`), 'utf8'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async getMany(ids: string[]): Promise<Skill[]> {
    const got = await Promise.all(ids.map((id) => this.get(id)));
    return got.filter((s): s is Skill => s !== null);
  }

  seed(fromDir: string): Promise<number> {
    return copyMissingFiles(fromDir, this.dir);
  }
}
```

- [ ] **Step 7: Write `src/main/agents/prompt.ts`**

```ts
import type { Role, Skill, Task } from '../../shared/types';

export interface PromptContext {
  agentName: string;
  bossName: string;
  branch: string;
  projectName: string;
  kind: 'boss' | 'employee';
}

export function renderPrompt(role: Role, skills: Skill[], ctx: PromptContext): string {
  const parts: string[] = [];
  if (ctx.kind === 'boss') {
    parts.push(`You are ${ctx.agentName}, the boss of the "${ctx.projectName}" team in AgentOffice.`);
  } else {
    parts.push(`You are ${ctx.agentName}, the ${role.name} on the "${ctx.projectName}" team. Your boss is ${ctx.bossName}.`);
  }
  parts.push(role.systemPrompt.trim());
  if (skills.length > 0) {
    parts.push('## Skills');
    for (const s of skills) parts.push(`### ${s.name}\n${s.body}`);
  }
  if (ctx.kind === 'employee') {
    parts.push(
      [
        '## Rules',
        `- Work only inside the current directory. It is your own git worktree on branch \`${ctx.branch}\`.`,
        '- Commit your work in small steps with clear messages. Do not switch branches.',
        '- Run the tests that cover your change before you finish.',
        '- Finish with a summary of at most 5 lines: what changed and how you verified it.',
      ].join('\n'),
    );
  }
  return parts.join('\n\n') + '\n';
}

export function taskMessage(task: Pick<Task, 'id' | 'title' | 'brief' | 'attempts'>): string {
  if (task.attempts > 0) {
    return `Continue working on task ${task.id} ("${task.title}") from where you left off. When you are finished, reply with a short summary (at most 5 lines).`;
  }
  return `# Task ${task.id}: ${task.title}\n\n${task.brief.trim()}\n\nWhen you are finished, reply with a short summary (at most 5 lines) of what you changed and how you verified it.`;
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/main/store src/main/agents/prompt.test.ts && npm run typecheck`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(roles): role/skill stores, built-in presets and prompt rendering

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Stream-json parser and live status

**Files:**
- Create: `src/main/claude/streamParser.ts`, `src/main/claude/status.ts`, `test/fixtures/stream/read-file.jsonl`
- Test: `src/main/claude/streamParser.test.ts`, `src/main/claude/status.test.ts`

**Interfaces:**
- Consumes: `RunnerEvent`, `AgentStatus` (Task 2).
- Produces: `class LineSplitter { push(chunk: string): string[]; flush(): string[] }`, `parseLine(line: string): RunnerEvent[]`, `describeTool(name: string, input: Record<string, unknown>): string`, `interface LiveState { status: AgentStatus; bubble: string }`, `reduceStatus(prev: LiveState, ev: RunnerEvent): LiveState`.

- [ ] **Step 1: Add the fixture** — `test/fixtures/stream/read-file.jsonl` (sanitized from a real `claude` 2.1.299 run)

```
{"type":"system","subtype":"hook_started","hook_id":"h1","hook_name":"SessionStart:startup","hook_event":"SessionStart","session_id":"sess-fixture-1","uuid":"u0"}
{"type":"system","subtype":"init","session_id":"sess-fixture-1","model":"claude-haiku-5-5","cwd":"/repo","tools":["Read"],"permissionMode":"acceptEdits","uuid":"u1"}
{"type":"system","subtype":"thinking_tokens","estimated_tokens":40,"estimated_tokens_delta":40,"session_id":"sess-fixture-1","uuid":"u2"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"thinking","thinking":"","signature":"sig"}]},"session_id":"sess-fixture-1","uuid":"u3"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_1","name":"Read","input":{"file_path":"/repo/src/a.txt"}}]},"session_id":"sess-fixture-1","uuid":"u4"}
{"type":"rate_limit_event","rate_limit_info":{},"session_id":"sess-fixture-1","uuid":"u5"}
{"type":"user","message":{"role":"user","content":[{"tool_use_id":"toolu_1","type":"tool_result","content":"1\thello\n2\t"}]},"session_id":"sess-fixture-1","uuid":"u6"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"DONE"}]},"session_id":"sess-fixture-1","uuid":"u7"}
{"type":"result","subtype":"success","is_error":false,"result":"DONE","session_id":"sess-fixture-1","num_turns":2,"total_cost_usd":0.0057,"duration_ms":5587,"uuid":"u8"}
```

- [ ] **Step 2: Write the failing tests**

`src/main/claude/streamParser.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { LineSplitter, parseLine } from './streamParser';

const fixture = readFileSync(path.resolve('test/fixtures/stream/read-file.jsonl'), 'utf8');

describe('LineSplitter', () => {
  it('reassembles lines split across chunks, including CRLF split between chunks', () => {
    const s = new LineSplitter();
    expect(s.push('{"a":')).toEqual([]);
    expect(s.push('1}\r')).toEqual([]);
    expect(s.push('\n{"b":2}\n\n')).toEqual(['{"a":1}', '{"b":2}']);
    expect(s.push('{"c":3}')).toEqual([]);
    expect(s.flush()).toEqual(['{"c":3}']);
    expect(s.flush()).toEqual([]);
  });
});

describe('parseLine', () => {
  it('turns the real fixture into the expected event sequence', () => {
    const events = fixture.split('\n').filter(Boolean).flatMap(parseLine);
    expect(events.map((e) => e.type)).toEqual(['init', 'thinking', 'tool_use', 'tool_result', 'text', 'result']);
    expect(events[0]).toEqual({ type: 'init', sessionId: 'sess-fixture-1', model: 'claude-haiku-5-5' });
    expect(events[2]).toMatchObject({ type: 'tool_use', name: 'Read', input: { file_path: '/repo/src/a.txt' } });
    expect(events[3]).toMatchObject({ type: 'tool_result', toolUseId: 'toolu_1', isError: false, preview: '1\thello\n2\t' });
    expect(events[5]).toEqual({ type: 'result', ok: true, text: 'DONE', sessionId: 'sess-fixture-1', costUsd: 0.0057, durationMs: 5587, numTurns: 2 });
  });

  it('never throws on junk and reports it as raw', () => {
    expect(parseLine('not json at all')).toEqual([{ type: 'raw', text: 'not json at all' }]);
    expect(parseLine('{"type":"brand_new_event"}')).toEqual([]);
    expect(parseLine('{"type":"assistant"}')).toEqual([]);
    expect(parseLine('null')).toEqual([]);
  });

  it('marks error results as not ok and falls back to the subtype for text', () => {
    expect(parseLine('{"type":"result","subtype":"error_max_turns","is_error":true,"session_id":"s"}')[0]).toMatchObject({ type: 'result', ok: false, text: 'error_max_turns' });
  });

  it('reads tool_result content given as an array of text blocks', () => {
    const line = JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', is_error: true, content: [{ type: 'text', text: 'oops' }] }] } });
    expect(parseLine(line)).toEqual([{ type: 'tool_result', toolUseId: 't', isError: true, preview: 'oops' }]);
  });
});
```

`src/main/claude/status.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { describeTool, reduceStatus, type LiveState } from './status';

const idle: LiveState = { status: 'idle', bubble: 'Idle' };

describe('describeTool', () => {
  it('names the file being touched, on POSIX and Windows paths', () => {
    expect(describeTool('Edit', { file_path: '/repo/src/ThemeToggle.tsx' })).toBe('Editing ThemeToggle.tsx');
    expect(describeTool('Write', { file_path: 'C:\\repo\\src\\a.ts' })).toBe('Writing a.ts');
    expect(describeTool('Read', { file_path: '/x/README.md' })).toBe('Reading README.md');
  });
  it('summarises other tools', () => {
    expect(describeTool('Bash', { command: 'npm test -- --run ThemeToggle and more words' })).toBe('Running npm test -- --run Theme…');
    expect(describeTool('Grep', { pattern: 'useTheme' })).toBe('Searching "useTheme"');
    expect(describeTool('mcp__agentoffice__assign_task', { agent: 'Pixel' })).toBe('Assigning Pixel');
    expect(describeTool('Mystery', {})).toBe('Using Mystery');
  });
});

describe('reduceStatus', () => {
  it('follows a session from start to finish', () => {
    let s = reduceStatus(idle, { type: 'init', sessionId: 's', model: 'm' });
    expect(s).toEqual({ status: 'thinking', bubble: 'Starting…' });
    s = reduceStatus(s, { type: 'tool_use', id: '1', name: 'Edit', input: { file_path: '/a/b.ts' } });
    expect(s).toEqual({ status: 'working', bubble: 'Editing b.ts' });
    s = reduceStatus(s, { type: 'tool_result', toolUseId: '1', isError: false, preview: '' });
    expect(s.status).toBe('working');
    s = reduceStatus(s, { type: 'text', text: 'All tests pass now and the toggle works in both themes.' });
    expect(s).toEqual({ status: 'thinking', bubble: 'All tests pass now and the toggle works…' });
    s = reduceStatus(s, { type: 'result', ok: true, text: '', sessionId: 's', costUsd: 0, durationMs: 0, numTurns: 1 });
    expect(s).toEqual({ status: 'done', bubble: 'Done' });
    expect(reduceStatus(s, { type: 'exit', code: 0, signal: null })).toEqual({ status: 'done', bubble: 'Done' });
  });

  it('shows an error when the process dies without a result', () => {
    const s = reduceStatus({ status: 'working', bubble: 'x' }, { type: 'exit', code: 3, signal: null });
    expect(s).toEqual({ status: 'error', bubble: 'Exited (3)' });
  });

  it('goes idle after a clean exit while not mid-task', () => {
    expect(reduceStatus({ status: 'thinking', bubble: 'x' }, { type: 'exit', code: 0, signal: null })).toEqual({ status: 'idle', bubble: 'Idle' });
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run src/main/claude`
Expected: FAIL — modules not found.

- [ ] **Step 4: Write `src/main/claude/streamParser.ts`**

```ts
import type { RunnerEvent } from '../../shared/types';

export class LineSplitter {
  private buf = '';

  push(chunk: string): string[] {
    this.buf += chunk;
    const parts = this.buf.split(/\r?\n/);
    this.buf = parts.pop() ?? '';
    return parts.map((l) => l.trim()).filter((l) => l.length > 0);
  }

  flush(): string[] {
    const rest = this.buf.trim();
    this.buf = '';
    return rest ? [rest] : [];
  }
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => (isObj(c) && typeof c.text === 'string' ? c.text : '')).join('');
  return '';
}

export function parseLine(line: string): RunnerEvent[] {
  let d: unknown;
  try {
    d = JSON.parse(line);
  } catch {
    return [{ type: 'raw', text: line.slice(0, 500) }];
  }
  if (!isObj(d)) return [];

  switch (d.type) {
    case 'system':
      if (d.subtype === 'init') return [{ type: 'init', sessionId: String(d.session_id ?? ''), model: String(d.model ?? '') }];
      return [];
    case 'assistant': {
      const content = isObj(d.message) ? d.message.content : undefined;
      if (!Array.isArray(content)) return [];
      const out: RunnerEvent[] = [];
      for (const c of content) {
        if (!isObj(c)) continue;
        if (c.type === 'text' && typeof c.text === 'string' && c.text.trim()) out.push({ type: 'text', text: c.text });
        else if (c.type === 'thinking') out.push({ type: 'thinking' });
        else if (c.type === 'tool_use') out.push({ type: 'tool_use', id: String(c.id ?? ''), name: String(c.name ?? ''), input: isObj(c.input) ? c.input : {} });
      }
      return out;
    }
    case 'user': {
      const content = isObj(d.message) ? d.message.content : undefined;
      if (!Array.isArray(content)) return [];
      return content
        .filter((c): c is Json => isObj(c) && c.type === 'tool_result')
        .map((c) => ({ type: 'tool_result' as const, toolUseId: String(c.tool_use_id ?? ''), isError: c.is_error === true, preview: textOf(c.content).slice(0, 300) }));
    }
    case 'result':
      return [{
        type: 'result',
        ok: d.is_error !== true && d.subtype === 'success',
        text: typeof d.result === 'string' ? d.result : String(d.subtype ?? ''),
        sessionId: String(d.session_id ?? ''),
        costUsd: Number(d.total_cost_usd ?? 0),
        durationMs: Number(d.duration_ms ?? 0),
        numTurns: Number(d.num_turns ?? 0),
      }];
    default:
      return [];
  }
}
```

- [ ] **Step 5: Write `src/main/claude/status.ts`**

```ts
import type { AgentStatus, RunnerEvent } from '../../shared/types';

export interface LiveState { status: AgentStatus; bubble: string }

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const base = (p: unknown) => String(p ?? '').split(/[\\/]/).filter(Boolean).pop() ?? '';

export function describeTool(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Read': return `Reading ${base(input.file_path)}`;
    case 'Edit':
    case 'MultiEdit': return `Editing ${base(input.file_path)}`;
    case 'Write': return `Writing ${base(input.file_path)}`;
    case 'Bash': return `Running ${clip(String(input.command ?? ''), 24)}`;
    case 'Grep':
    case 'Glob': return `Searching "${clip(String(input.pattern ?? ''), 24)}"`;
    case 'WebFetch':
    case 'WebSearch': return 'Browsing the web';
    case 'Task':
    case 'Agent': return 'Delegating a subtask';
  }
  if (name.startsWith('mcp__')) {
    const tool = name.split('__').pop() ?? name;
    if (tool === 'assign_task') return `Assigning ${String(input.agent ?? 'a task')}`;
    return `Using ${tool}`;
  }
  return `Using ${name}`;
}

export function reduceStatus(prev: LiveState, ev: RunnerEvent): LiveState {
  switch (ev.type) {
    case 'init': return { status: 'thinking', bubble: 'Starting…' };
    case 'thinking': return { status: 'thinking', bubble: 'Thinking…' };
    case 'text': return { status: 'thinking', bubble: clip(ev.text.replace(/\s+/g, ' ').trim(), 40) };
    case 'tool_use': return { status: 'working', bubble: describeTool(ev.name, ev.input) };
    case 'result': return ev.ok ? { status: 'done', bubble: 'Done' } : { status: 'error', bubble: 'Hit a problem' };
    case 'exit':
      if (prev.status === 'done' || prev.status === 'error' || prev.status === 'paused') return prev;
      if (prev.status === 'working' || ev.code !== 0) return { status: 'error', bubble: `Exited (${ev.code ?? ev.signal})` };
      return { status: 'idle', bubble: 'Idle' };
    default: return prev;
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/main/claude && npm run typecheck`
Expected: all PASS. (Check: `clip('npm test -- --run ThemeToggle and more words', 24)` gives `'npm test -- --run Theme…'`, and the 40-char clip in the text case gives `'All tests pass now and the toggle works…'`. If a clip expectation differs by one character, fix the test string, not `clip`.)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(claude): stream-json parser and live status derivation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Finding the CLI, GUI PATH fix, launch arguments

**Files:**
- Create: `src/main/claude/locate.ts`, `src/main/claude/shellPath.ts`, `src/main/claude/args.ts`
- Test: `src/main/claude/locate.test.ts`, `src/main/claude/shellPath.test.ts`, `src/main/claude/args.test.ts`

**Interfaces:**
- Consumes: `PermissionMode` (Task 2).
- Produces:
  - `interface LocateEnv { platform: NodeJS.Platform; env: Record<string, string | undefined>; home: string; isFile(p: string): boolean }`
  - `candidatePaths(e): string[]`, `locateClaude(e, override?): string | null`, `parseVersion(out: string): string | null`, `claudeVersion(bin: string): string | null`, `systemLocateEnv(): LocateEnv`
  - `mergePathLists(primary, extra, delimiter): string`, `readLoginShellPath(shell?): string | null`, `fixGuiPath(env?, platform?): void`
  - `interface ClaudeLaunch { model?; permissionMode?; allowedTools?; appendSystemPromptFile?; mcpConfigPath?; sessionId?; resume?; isolateUserSettings? }`, `buildClaudeArgs(l): string[]`, `userMessageLine(text): string`

- [ ] **Step 1: Write the failing tests**

`src/main/claude/locate.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { candidatePaths, locateClaude, parseVersion, type LocateEnv } from './locate';

const posix = (files: string[], PATH = '/usr/bin:/home/u/.local/bin'): LocateEnv => ({
  platform: 'darwin', env: { PATH }, home: '/home/u', isFile: (p) => files.includes(p),
});

describe('locateClaude', () => {
  it('finds claude on PATH first (POSIX)', () => {
    expect(locateClaude(posix(['/home/u/.local/bin/claude', '/opt/homebrew/bin/claude']))).toBe('/home/u/.local/bin/claude');
  });

  it('falls back to known install locations when PATH is minimal (GUI launch)', () => {
    expect(locateClaude(posix(['/home/u/.claude/local/claude'], '/usr/bin:/bin'))).toBe('/home/u/.claude/local/claude');
  });

  it('honours PATHEXT on Windows and finds the npm .cmd shim', () => {
    const e: LocateEnv = {
      platform: 'win32',
      env: { Path: 'C:\\Windows;C:\\Users\\u\\AppData\\Roaming\\npm', PATHEXT: '.COM;.EXE;.CMD', APPDATA: 'C:\\Users\\u\\AppData\\Roaming' },
      home: 'C:\\Users\\u',
      isFile: (p) => p === 'C:\\Users\\u\\AppData\\Roaming\\npm\\claude.cmd',
    };
    expect(candidatePaths(e)).toContain('C:\\Users\\u\\AppData\\Roaming\\npm\\claude.cmd');
    expect(locateClaude(e)).toBe('C:\\Users\\u\\AppData\\Roaming\\npm\\claude.cmd');
  });

  it('uses an override only if it exists', () => {
    expect(locateClaude(posix(['/x/claude']), '/x/claude')).toBe('/x/claude');
    expect(locateClaude(posix(['/home/u/.local/bin/claude']), '/missing/claude')).toBeNull();
  });

  it('returns null when nothing is installed', () => {
    expect(locateClaude(posix([]))).toBeNull();
  });
});

describe('parseVersion', () => {
  it('extracts the semver from `claude --version` output', () => {
    expect(parseVersion('2.1.299 (Claude Code)\n')).toBe('2.1.299');
    expect(parseVersion('garbage')).toBeNull();
  });
});
```

`src/main/claude/shellPath.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { mergePathLists } from './shellPath';

describe('mergePathLists', () => {
  it('keeps the original order and appends new entries once', () => {
    expect(mergePathLists('/usr/bin:/bin', '/opt/homebrew/bin:/usr/bin:/home/u/.local/bin', ':')).toBe('/usr/bin:/bin:/opt/homebrew/bin:/home/u/.local/bin');
  });
  it('handles empty inputs', () => {
    expect(mergePathLists('', '/a', ':')).toBe('/a');
    expect(mergePathLists('/a', '', ':')).toBe('/a');
  });
});
```

`src/main/claude/args.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildClaudeArgs, userMessageLine } from './args';

describe('buildClaudeArgs', () => {
  it('always uses headless stream-json in and out', () => {
    expect(buildClaudeArgs({})).toEqual(['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose']);
  });

  it('adds every option, passing tools as separate args so patterns with commas survive', () => {
    const args = buildClaudeArgs({
      model: 'sonnet', permissionMode: 'acceptEdits', allowedTools: ['Read', 'Bash(npm run test, lint)'],
      appendSystemPromptFile: '/tmp/p.md', mcpConfigPath: '/tmp/mcp.json', sessionId: 'abc', isolateUserSettings: true,
    });
    expect(args).toEqual([
      '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--model', 'sonnet',
      '--permission-mode', 'acceptEdits',
      '--append-system-prompt-file', '/tmp/p.md',
      '--mcp-config', '/tmp/mcp.json', '--strict-mcp-config',
      '--session-id', 'abc',
      '--setting-sources', 'project,local',
      '--allowedTools', 'Read', 'Bash(npm run test, lint)',
    ]);
  });

  it('prefers resume over a new session id', () => {
    const args = buildClaudeArgs({ resume: 'old', sessionId: 'new' });
    expect(args).toContain('--resume');
    expect(args).not.toContain('--session-id');
  });
});

describe('userMessageLine', () => {
  it('encodes one stream-json user message per line', () => {
    expect(userMessageLine('hi\nthere')).toBe('{"type":"user","message":{"role":"user","content":"hi\\nthere"}}\n');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/main/claude/locate.test.ts src/main/claude/shellPath.test.ts src/main/claude/args.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `src/main/claude/locate.ts`**

```ts
import { statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crossSpawn from 'cross-spawn';

export interface LocateEnv {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  home: string;
  isFile(p: string): boolean;
}

export function candidatePaths(e: LocateEnv): string[] {
  const win = e.platform === 'win32';
  const p = win ? path.win32 : path.posix;
  const pathVar = (win ? e.env.Path ?? e.env.PATH : e.env.PATH) ?? '';
  const dirs = pathVar.split(win ? ';' : ':').filter(Boolean);
  const exts = win ? (e.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map((x) => x.toLowerCase()) : [''];
  const fromPath = dirs.flatMap((d) => exts.map((x) => p.join(d, `claude${x}`)));
  const known = win
    ? [
        e.env.APPDATA ? p.join(e.env.APPDATA, 'npm', 'claude.cmd') : null,
        e.env.LOCALAPPDATA ? p.join(e.env.LOCALAPPDATA, 'Programs', 'claude', 'claude.exe') : null,
        p.join(e.home, '.local', 'bin', 'claude.exe'),
      ]
    : [
        p.join(e.home, '.local', 'bin', 'claude'),
        p.join(e.home, '.claude', 'local', 'claude'),
        '/opt/homebrew/bin/claude',
        '/usr/local/bin/claude',
      ];
  return [...new Set([...fromPath, ...known.filter((x): x is string => x !== null)])];
}

export function locateClaude(e: LocateEnv, override?: string): string | null {
  if (override) return e.isFile(override) ? override : null;
  return candidatePaths(e).find((c) => e.isFile(c)) ?? null;
}

export function parseVersion(out: string): string | null {
  return /(\d+\.\d+\.\d+)/.exec(out)?.[1] ?? null;
}

export function claudeVersion(bin: string): string | null {
  const r = crossSpawn.sync(bin, ['--version'], { encoding: 'utf8', timeout: 15000, windowsHide: true });
  if (r.status !== 0 || typeof r.stdout !== 'string') return null;
  return parseVersion(r.stdout);
}

export function systemLocateEnv(): LocateEnv {
  return {
    platform: process.platform,
    env: process.env,
    home: os.homedir(),
    isFile: (p) => {
      try { return statSync(p).isFile(); } catch { return false; }
    },
  };
}
```

- [ ] **Step 4: Write `src/main/claude/shellPath.ts`**

```ts
import { spawnSync } from 'node:child_process';

export function mergePathLists(primary: string, extra: string, delimiter: string): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of [...primary.split(delimiter), ...extra.split(delimiter)]) {
    if (d && !seen.has(d)) { seen.add(d); out.push(d); }
  }
  return out.join(delimiter);
}

/** GUI apps on macOS/Linux start with a minimal PATH; ask the user's login shell for the real one. */
export function readLoginShellPath(shell = process.env.SHELL || '/bin/bash'): string | null {
  const r = spawnSync(shell, ['-ilc', 'printf "__AO_PATH__%s__AO_PATH__" "$PATH"'], { encoding: 'utf8', timeout: 5000 });
  const m = /__AO_PATH__([\s\S]*?)__AO_PATH__/.exec(r.stdout ?? '');
  return m ? m[1] : null;
}

export function fixGuiPath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): void {
  if (platform === 'win32') return;
  const login = readLoginShellPath();
  if (login) env.PATH = mergePathLists(env.PATH ?? '', login, ':');
}
```

- [ ] **Step 5: Write `src/main/claude/args.ts`**

```ts
import type { PermissionMode } from '../../shared/types';

export interface ClaudeLaunch {
  model?: string;
  permissionMode?: PermissionMode;
  allowedTools?: string[];
  appendSystemPromptFile?: string;
  mcpConfigPath?: string;
  sessionId?: string;
  resume?: string;
  /** Load only project/local settings so the user's global hooks and plugins stay out. */
  isolateUserSettings?: boolean;
}

export function buildClaudeArgs(l: ClaudeLaunch): string[] {
  const a = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'];
  if (l.model) a.push('--model', l.model);
  if (l.permissionMode) a.push('--permission-mode', l.permissionMode);
  if (l.appendSystemPromptFile) a.push('--append-system-prompt-file', l.appendSystemPromptFile);
  if (l.mcpConfigPath) a.push('--mcp-config', l.mcpConfigPath, '--strict-mcp-config');
  if (l.resume) a.push('--resume', l.resume);
  else if (l.sessionId) a.push('--session-id', l.sessionId);
  if (l.isolateUserSettings) a.push('--setting-sources', 'project,local');
  // Variadic flag goes last so it cannot swallow anything after it.
  if (l.allowedTools && l.allowedTools.length > 0) a.push('--allowedTools', ...l.allowedTools);
  return a;
}

export function userMessageLine(text: string): string {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n';
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/main/claude && npm run typecheck`
Expected: all PASS.

- [ ] **Step 7: Check the real CLI accepts the flags**

Run (in a scratch git repo, costs one tiny haiku turn):
```bash
printf '%s\n' '{"type":"user","message":{"role":"user","content":"Reply with just OK."}}' | claude -p --input-format stream-json --output-format stream-json --verbose --model haiku --permission-mode acceptEdits --setting-sources project,local --allowedTools Read Grep | tail -1
```
Expected: a single `{"type":"result","subtype":"success",…"result":"OK"…}` line. If the CLI rejects a flag, fix `buildClaudeArgs` and its test to match `claude --help`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(claude): cross-platform CLI discovery, GUI PATH fix and launch args

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: ClaudeRunner, process-tree kill and the fake CLI

**Files:**
- Create: `src/main/claude/killTree.ts`, `src/main/claude/runner.ts`, `test/fake-claude/fake-claude.mjs`, `test/helpers/runner.ts`
- Test: `test/runner.test.ts`

**Interfaces:**
- Consumes: `LineSplitter`, `parseLine` (Task 4); `buildClaudeArgs`, `userMessageLine`, `ClaudeLaunch` (Task 5); `RunnerEvent` (Task 2).
- Produces:
  - `killTree(pid: number, platform?: NodeJS.Platform): void`
  - `interface AgentRunner { readonly running: boolean; readonly lastStderr: string; start(): void; send(text: string): void; endInput(): void; stop(): void; on(event: 'event', listener: (ev: RunnerEvent) => void): this }`
  - `interface ClaudeRunnerOptions { bin: string; binArgs?: string[]; cwd: string; launch: ClaudeLaunch; env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform }`
  - `class ClaudeRunner extends EventEmitter implements AgentRunner`
  - Test helpers: `FAKE_CLAUDE` (absolute path), `fakeRunner(cwd, env?, launch?): ClaudeRunner`, `waitForEvent(runner, predicate, ms?): Promise<RunnerEvent>`, `collect(runner): RunnerEvent[]`
  - Fake CLI env switches: `FAKE_CLAUDE_FIXTURE` (jsonl replayed each turn, `result` lines skipped), `FAKE_CLAUDE_ARGV_OUT` (appends `{argv,cwd}` per launch), `FAKE_CLAUDE_FILE` (appends a line to this file in cwd each turn), `FAKE_CLAUDE_DELAY_MS`, `FAKE_CLAUDE_HANG=1` (never sends a result), `FAKE_CLAUDE_CRASH=1` (stderr + exit 3), `FAKE_CLAUDE_FAIL=1` (error result).

- [ ] **Step 1: Write the fake CLI** — `test/fake-claude/fake-claude.mjs`

```js
#!/usr/bin/env node
// A scripted stand-in for the `claude` CLI, controlled by FAKE_CLAUDE_* env vars.
import fs from 'node:fs';
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';

const argv = process.argv.slice(2);
const env = process.env;
if (env.FAKE_CLAUDE_ARGV_OUT) fs.appendFileSync(env.FAKE_CLAUDE_ARGV_OUT, JSON.stringify({ argv, cwd: process.cwd() }) + '\n');
if (argv.includes('--version')) {
  process.stdout.write('9.9.9 (Claude Code)\n');
  process.exit(0);
}

const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const sessionId = flag('--resume') ?? flag('--session-id') ?? randomUUID();
const fixture = env.FAKE_CLAUDE_FIXTURE ? fs.readFileSync(env.FAKE_CLAUDE_FIXTURE, 'utf8').split(/\r?\n/).filter(Boolean) : [];
const delay = Number(env.FAKE_CLAUDE_DELAY_MS ?? 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');

let turns = 0;
let queue = Promise.resolve();
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => { queue = queue.then(() => handle(line)); });
rl.on('close', () => { queue.then(() => process.exit(0)); });

async function handle(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.type !== 'user') return;
  const c = msg.message?.content;
  const content = typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => x.text ?? '').join('') : '';
  turns++;
  out({ type: 'system', subtype: 'init', session_id: sessionId, model: 'fake-model' });
  for (const l of fixture) {
    const o = JSON.parse(l);
    if (o.type === 'result' || (o.type === 'system' && o.subtype === 'init')) continue;
    o.session_id = sessionId;
    out(o);
    if (delay) await sleep(delay);
  }
  if (env.FAKE_CLAUDE_FILE) fs.appendFileSync(env.FAKE_CLAUDE_FILE, `turn ${turns}: ${content.split('\n')[0]}\n`);
  if (env.FAKE_CLAUDE_CRASH === '1') {
    process.stderr.write('boom: simulated crash\n');
    process.exit(3);
  }
  if (env.FAKE_CLAUDE_HANG === '1') return;
  const fail = env.FAKE_CLAUDE_FAIL === '1';
  out({
    type: 'result', subtype: fail ? 'error_during_execution' : 'success', is_error: fail,
    result: fail ? 'simulated failure' : `echo: ${content.slice(0, 200)}`,
    session_id: sessionId, num_turns: turns, total_cost_usd: 0, duration_ms: 1,
  });
}
```

- [ ] **Step 2: Write the test helpers** — `test/helpers/runner.ts`

```ts
import path from 'node:path';
import { ClaudeRunner } from '../../src/main/claude/runner';
import type { ClaudeLaunch } from '../../src/main/claude/args';
import type { RunnerEvent } from '../../src/shared/types';

export const FAKE_CLAUDE = path.resolve('test/fake-claude/fake-claude.mjs');
export const FIXTURE = path.resolve('test/fixtures/stream/read-file.jsonl');

export function fakeRunner(cwd: string, env: Record<string, string> = {}, launch: ClaudeLaunch = {}, script = FAKE_CLAUDE): ClaudeRunner {
  return new ClaudeRunner({ bin: process.execPath, binArgs: [script], cwd, launch, env: { ...process.env, ...env } });
}

export function collect(runner: { on(e: 'event', l: (ev: RunnerEvent) => void): unknown }): RunnerEvent[] {
  const events: RunnerEvent[] = [];
  runner.on('event', (ev) => events.push(ev));
  return events;
}

export function waitForEvent(
  runner: { on(e: 'event', l: (ev: RunnerEvent) => void): unknown; off(e: 'event', l: (ev: RunnerEvent) => void): unknown },
  pred: (ev: RunnerEvent) => boolean,
  ms = 15000,
): Promise<RunnerEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { runner.off('event', listener); reject(new Error('timed out waiting for runner event')); }, ms);
    const listener = (ev: RunnerEvent) => {
      if (pred(ev)) { clearTimeout(timer); runner.off('event', listener); resolve(ev); }
    };
    runner.on('event', listener);
  });
}
```

- [ ] **Step 3: Write the failing tests** — `test/runner.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ClaudeRunner } from '../src/main/claude/runner';
import { FAKE_CLAUDE, FIXTURE, collect, fakeRunner, waitForEvent } from './helpers/runner';

let dir: string;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-run-')); });
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

describe('ClaudeRunner', () => {
  it('streams parsed events for a turn and exits cleanly when input ends', async () => {
    const r = fakeRunner(dir, { FAKE_CLAUDE_FIXTURE: FIXTURE });
    const events = collect(r);
    r.start();
    r.send('Read a.txt');
    await waitForEvent(r, (e) => e.type === 'result');
    r.endInput();
    const exit = await waitForEvent(r, (e) => e.type === 'exit');
    expect(exit).toEqual({ type: 'exit', code: 0, signal: null });
    expect(events.map((e) => e.type)).toEqual(['init', 'thinking', 'tool_use', 'tool_result', 'text', 'result', 'exit']);
    expect(r.running).toBe(false);
  });

  it('keeps one session across several turns', async () => {
    const r = fakeRunner(dir);
    r.start();
    r.send('first');
    const a = await waitForEvent(r, (e) => e.type === 'result');
    r.send('second');
    const b = await waitForEvent(r, (e) => e.type === 'result');
    r.endInput();
    await waitForEvent(r, (e) => e.type === 'exit');
    expect(a).toMatchObject({ text: 'echo: first' });
    expect(b).toMatchObject({ text: 'echo: second' });
    expect(a.type === 'result' && b.type === 'result' && a.sessionId === b.sessionId).toBe(true);
  });

  it('passes launch options through as CLI flags in the given cwd', async () => {
    const argvOut = path.join(dir, 'argv.jsonl');
    const r = fakeRunner(dir, { FAKE_CLAUDE_ARGV_OUT: argvOut }, { sessionId: 'sess-123', model: 'haiku', isolateUserSettings: true });
    r.start();
    r.send('x');
    await waitForEvent(r, (e) => e.type === 'result');
    r.endInput();
    await waitForEvent(r, (e) => e.type === 'exit');
    const rec = JSON.parse((await fs.readFile(argvOut, 'utf8')).trim());
    expect(rec.argv).toEqual(expect.arrayContaining(['--session-id', 'sess-123', '--model', 'haiku', '--setting-sources', 'project,local']));
    expect(await fs.realpath(rec.cwd)).toBe(await fs.realpath(dir));
  });

  it('reports a crash with the stderr tail', async () => {
    const r = fakeRunner(dir, { FAKE_CLAUDE_CRASH: '1' });
    r.start();
    r.send('x');
    const exit = await waitForEvent(r, (e) => e.type === 'exit');
    expect(exit).toMatchObject({ code: 3 });
    expect(r.lastStderr).toContain('boom: simulated crash');
  });

  it('stop() kills a hanging session', async () => {
    const r = fakeRunner(dir, { FAKE_CLAUDE_HANG: '1' });
    r.start();
    r.send('x');
    await waitForEvent(r, (e) => e.type === 'init');
    r.stop();
    await waitForEvent(r, (e) => e.type === 'exit', 10000);
    expect(r.running).toBe(false);
  });

  it('works when the script lives in a folder with a space in its name', async () => {
    const spaced = path.join(dir, 'with space');
    await fs.mkdir(spaced);
    const script = path.join(spaced, 'fake claude.mjs');
    await fs.copyFile(FAKE_CLAUDE, script);
    const r = fakeRunner(spaced, {}, {}, script);
    r.start();
    r.send('hello');
    expect(await waitForEvent(r, (e) => e.type === 'result')).toMatchObject({ text: 'echo: hello' });
    r.endInput();
    await waitForEvent(r, (e) => e.type === 'exit');
  });

  it('emits exit (not a throw) when the binary does not exist', async () => {
    const r = new ClaudeRunner({ bin: path.join(dir, 'no-such-claude'), cwd: dir, launch: {} });
    const exited = waitForEvent(r, (e) => e.type === 'exit');
    r.start();
    await exited;
    expect(r.lastStderr).toMatch(/ENOENT|not found|not recognized/i);
  });

  it('refuses to send when not running', () => {
    const r = fakeRunner(dir);
    expect(() => r.send('x')).toThrow(/not running/);
  });
});
```

- [ ] **Step 4: Run them to verify they fail**

Run: `npx vitest run test/runner.test.ts`
Expected: FAIL — `../src/main/claude/runner` not found.

- [ ] **Step 5: Write `src/main/claude/killTree.ts`**

```ts
import { spawn } from 'node:child_process';

/** Kill a process and its children. POSIX children must be spawned with `detached: true`. */
export function killTree(pid: number, platform: NodeJS.Platform = process.platform): void {
  if (platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {});
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
  }
}
```

- [ ] **Step 6: Write `src/main/claude/runner.ts`**

```ts
import { EventEmitter } from 'node:events';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import crossSpawn from 'cross-spawn';
import type { RunnerEvent } from '../../shared/types';
import { buildClaudeArgs, userMessageLine, type ClaudeLaunch } from './args';
import { killTree } from './killTree';
import { LineSplitter, parseLine } from './streamParser';

export interface AgentRunner {
  readonly running: boolean;
  readonly lastStderr: string;
  start(): void;
  send(text: string): void;
  endInput(): void;
  stop(): void;
  on(event: 'event', listener: (ev: RunnerEvent) => void): this;
  off(event: 'event', listener: (ev: RunnerEvent) => void): this;
}

export interface ClaudeRunnerOptions {
  bin: string;
  /** Extra args placed before the claude flags (used to run a .mjs through node in tests). */
  binArgs?: string[];
  cwd: string;
  launch: ClaudeLaunch;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

export class ClaudeRunner extends EventEmitter implements AgentRunner {
  private child: ChildProcessWithoutNullStreams | null = null;
  private stderrTail: string[] = [];

  constructor(private readonly opts: ClaudeRunnerOptions) {
    super();
  }

  get running(): boolean { return this.child !== null; }
  get lastStderr(): string { return this.stderrTail.join('\n'); }

  start(): void {
    if (this.child) throw new Error('runner already started');
    const platform = this.opts.platform ?? process.platform;
    const args = [...(this.opts.binArgs ?? []), ...buildClaudeArgs(this.opts.launch)];
    const child = crossSpawn(this.opts.bin, args, {
      cwd: this.opts.cwd,
      env: this.opts.env ?? process.env,
      stdio: 'pipe',
      detached: platform !== 'win32',
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams;
    this.child = child;

    const out = new LineSplitter();
    const err = new LineSplitter();
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (c: string) => { for (const l of out.push(c)) this.emitLine(l); });
    child.stderr.on('data', (c: string) => { for (const l of err.push(c)) this.pushStderr(l); });
    child.stdin.on('error', () => { /* EPIPE after the process died; exit is reported separately */ });
    child.on('error', (e) => { this.pushStderr(e.message); this.finish(null, null, child); });
    child.on('close', (code, signal) => {
      for (const l of out.flush()) this.emitLine(l);
      for (const l of err.flush()) this.pushStderr(l);
      this.finish(code, signal, child);
    });
  }

  send(text: string): void {
    if (!this.child || !this.child.stdin.writable) throw new Error('runner is not running');
    this.child.stdin.write(userMessageLine(text));
  }

  endInput(): void {
    this.child?.stdin.end();
  }

  stop(): void {
    const pid = this.child?.pid;
    if (pid) killTree(pid, this.opts.platform ?? process.platform);
  }

  private emitLine(line: string): void {
    for (const ev of parseLine(line)) this.emit('event', ev);
  }

  private pushStderr(line: string): void {
    this.stderrTail.push(line);
    if (this.stderrTail.length > 20) this.stderrTail.shift();
    this.emit('event', { type: 'stderr', text: line } satisfies RunnerEvent);
  }

  private finish(code: number | null, signal: NodeJS.Signals | null, child: ChildProcessWithoutNullStreams): void {
    if (this.child !== child) return;
    this.child = null;
    this.emit('event', { type: 'exit', code, signal } satisfies RunnerEvent);
  }
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run test/runner.test.ts && npm run typecheck`
Expected: all PASS. If the "binary does not exist" test hangs on one platform, check that `child.on('error')` fires; cross-spawn on Windows reports `ENOENT` through `error` too.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(claude): ClaudeRunner with stream-json IO, tree kill and fake CLI for tests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Git worktrees

**Files:**
- Create: `src/main/git/worktrees.ts`, `test/helpers/repo.ts`
- Test: `src/main/git/slugify.test.ts`, `test/worktrees.test.ts`

**Interfaces:**
- Consumes: `DiffStat` (Task 2).
- Produces:
  - `git(cwd: string, args: string[]): Promise<string>`
  - `slugify(s: string, fallback?: string): string`
  - `interface RepoInfo { root: string; branch: string }`, `inspectRepo(dir: string): Promise<RepoInfo>`
  - `parseNumstat(out: string): DiffStat[]`
  - `class WorktreeManager(repoRoot) { worktreePath(agentName): string; ensureExcluded(): Promise<void>; prepare(agentName, branch, fromRef): Promise<string>; commitAll(worktree, message): Promise<boolean>; diffStat(base, branch): Promise<DiffStat[]>; remove(agentName): Promise<void> }`
  - Test helper: `makeRepo(): Promise<string>` (realpath of a temp repo with one commit on `main`)

- [ ] **Step 1: Write the test helper** — `test/helpers/repo.ts`

```ts
import { promises as fs, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git } from '../../src/main/git/worktrees';

export async function makeRepo(): Promise<string> {
  const dir = realpathSync.native(await fs.mkdtemp(path.join(os.tmpdir(), 'ao-repo-')));
  await git(dir, ['init', '-q', '-b', 'main']);
  await git(dir, ['config', 'user.name', 'Test User']);
  await git(dir, ['config', 'user.email', 'test@example.com']);
  await git(dir, ['config', 'commit.gpgsign', 'false']);
  await fs.writeFile(path.join(dir, 'README.md'), 'hello\n');
  await git(dir, ['add', '.']);
  await git(dir, ['commit', '-q', '-m', 'init']);
  return dir;
}
```

- [ ] **Step 2: Write the failing tests**

`src/main/git/slugify.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseNumstat, slugify } from './worktrees';

describe('slugify', () => {
  it.each([
    ['Pixel', 'pixel'],
    ['Dr. Who/QA', 'dr-who-qa'],
    ['Zoë', 'zoe'],
    ['../../etc', 'etc'],
    ['   ', 'agent'],
    ['🤖🤖', 'agent'],
    ['A'.repeat(80), 'a'.repeat(40)],
  ])('%s -> %s', (input, out) => {
    expect(slugify(input)).toBe(out);
  });

  it('uses a custom fallback', () => {
    expect(slugify('!!!', 'task')).toBe('task');
  });
});

describe('parseNumstat', () => {
  it('parses text and binary rows', () => {
    expect(parseNumstat('3\t1\tsrc/a.ts\n-\t-\timg.png\n')).toEqual([
      { path: 'src/a.ts', add: 3, del: 1 },
      { path: 'img.png', add: 0, del: 0 },
    ]);
    expect(parseNumstat('')).toEqual([]);
  });
});
```

`test/worktrees.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, promises as fs, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorktreeManager, git, inspectRepo } from '../src/main/git/worktrees';
import { makeRepo } from './helpers/repo';

let repo: string;
beforeEach(async () => { repo = await makeRepo(); });
afterEach(async () => { await fs.rm(repo, { recursive: true, force: true }); });

describe('inspectRepo', () => {
  it('returns the root and current branch, even from a subfolder', async () => {
    await fs.mkdir(path.join(repo, 'sub'));
    const info = await inspectRepo(path.join(repo, 'sub'));
    expect(realpathSync.native(info.root)).toBe(repo);
    expect(info.branch).toBe('main');
  });

  it('rejects a folder that is not a git repo', async () => {
    const plain = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-plain-'));
    await expect(inspectRepo(plain)).rejects.toThrow(/is not a git repository/);
    await fs.rm(plain, { recursive: true, force: true });
  });

  it('rejects a repo with no commits', async () => {
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-empty-'));
    await git(empty, ['init', '-q']);
    await expect(inspectRepo(empty)).rejects.toThrow(/no commits yet/);
    await fs.rm(empty, { recursive: true, force: true });
  });
});

describe('WorktreeManager', () => {
  it('creates a worktree on a new branch and hides .agentoffice from git status', async () => {
    const wm = new WorktreeManager(repo);
    const wt = await wm.prepare('Pixel', 'ao/pixel/t-101', 'main');
    expect(wt).toBe(path.join(repo, '.agentoffice', 'wt', 'pixel'));
    expect(await git(wt, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('ao/pixel/t-101');
    expect(await git(repo, ['status', '--porcelain'])).toBe('');
  });

  it('reuses the worktree for the next task and switches branch', async () => {
    const wm = new WorktreeManager(repo);
    await wm.prepare('Pixel', 'ao/pixel/one', 'main');
    const wt = await wm.prepare('Pixel', 'ao/pixel/two', 'main');
    expect(await git(wt, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('ao/pixel/two');
  });

  it('commits leftovers (including new files) and reports the diff against base', async () => {
    const wm = new WorktreeManager(repo);
    const wt = await wm.prepare('Byte', 'ao/byte/x', 'main');
    await fs.writeFile(path.join(wt, 'new.txt'), 'a\nb\n');
    await fs.appendFile(path.join(wt, 'README.md'), 'more\n');
    expect(await wm.commitAll(wt, 'T-101: work')).toBe(true);
    expect(await wm.commitAll(wt, 'nothing')).toBe(false);
    const stat = await wm.diffStat('main', 'ao/byte/x');
    expect(stat).toEqual(expect.arrayContaining([
      { path: 'new.txt', add: 2, del: 0 },
      { path: 'README.md', add: 1, del: 0 },
    ]));
    expect(await git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('main');
  });

  it('recreates a worktree whose folder was deleted by hand', async () => {
    const wm = new WorktreeManager(repo);
    const wt = await wm.prepare('Quinn', 'ao/quinn/a', 'main');
    await fs.rm(wt, { recursive: true, force: true });
    const again = await wm.prepare('Quinn', 'ao/quinn/a', 'main');
    expect(existsSync(path.join(again, 'README.md'))).toBe(true);
  });

  it('keeps worktrees inside .agentoffice/wt for hostile names', () => {
    const wm = new WorktreeManager(repo);
    const p = wm.worktreePath('../../../etc/passwd');
    expect(p.startsWith(path.join(repo, '.agentoffice', 'wt') + path.sep)).toBe(true);
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run src/main/git test/worktrees.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write `src/main/git/worktrees.ts`**

```ts
import { execFile } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { DiffStat } from '../../shared/types';

const pexec = promisify(execFile);

export async function git(cwd: string, args: string[]): Promise<string> {
  const pre = process.platform === 'win32' ? ['-c', 'core.longpaths=true'] : [];
  try {
    const { stdout } = await pexec('git', [...pre, ...args], { cwd, maxBuffer: 20 * 1024 * 1024, windowsHide: true });
    return stdout.trim();
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    throw new Error(`git ${args.join(' ')} failed: ${(err.stderr || err.message).trim()}`);
  }
}

export function slugify(s: string, fallback = 'agent'): string {
  const out = s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return out || fallback;
}

export interface RepoInfo { root: string; branch: string }

export async function inspectRepo(dir: string): Promise<RepoInfo> {
  let root: string;
  try {
    root = await git(dir, ['rev-parse', '--show-toplevel']);
  } catch {
    throw new Error(`${dir} is not a git repository`);
  }
  try {
    await git(root, ['rev-parse', '--verify', 'HEAD']);
  } catch {
    throw new Error('This repository has no commits yet. Make a first commit, then open it in AgentOffice.');
  }
  const branch = await git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return { root: path.resolve(root), branch };
}

export function parseNumstat(out: string): DiffStat[] {
  return out
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [a, d, ...rest] = line.split('\t');
      return { path: rest.join('\t'), add: Number(a) || 0, del: Number(d) || 0 };
    });
}

export class WorktreeManager {
  constructor(readonly repoRoot: string) {}

  worktreePath(agentName: string): string {
    return path.join(this.repoRoot, '.agentoffice', 'wt', slugify(agentName));
  }

  async ensureExcluded(): Promise<void> {
    const rel = await git(this.repoRoot, ['rev-parse', '--git-path', 'info/exclude']);
    const file = path.resolve(this.repoRoot, rel);
    let cur = '';
    try { cur = await fs.readFile(file, 'utf8'); } catch { /* no exclude file yet */ }
    if (cur.split(/\r?\n/).includes('.agentoffice/')) return;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, (cur && !cur.endsWith('\n') ? '\n' : '') + '.agentoffice/\n');
  }

  private async branchExists(branch: string): Promise<boolean> {
    try {
      await git(this.repoRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
      return true;
    } catch {
      return false;
    }
  }

  async prepare(agentName: string, branch: string, fromRef: string): Promise<string> {
    await this.ensureExcluded();
    const wt = this.worktreePath(agentName);
    const exists = await this.branchExists(branch);
    if (!existsSync(path.join(wt, '.git'))) {
      await git(this.repoRoot, ['worktree', 'prune']);
      await fs.rm(wt, { recursive: true, force: true });
      await fs.mkdir(path.dirname(wt), { recursive: true });
      await git(this.repoRoot, exists ? ['worktree', 'add', wt, branch] : ['worktree', 'add', '-b', branch, wt, fromRef]);
    } else {
      await git(wt, exists ? ['checkout', branch] : ['checkout', '-b', branch, fromRef]);
    }
    return wt;
  }

  async commitAll(worktree: string, message: string): Promise<boolean> {
    if (!(await git(worktree, ['status', '--porcelain']))) return false;
    await git(worktree, ['add', '-A']);
    const hasIdentity = await git(worktree, ['config', 'user.email']).then(Boolean, () => false);
    const identity = hasIdentity ? [] : ['-c', 'user.name=AgentOffice', '-c', 'user.email=agentoffice@localhost'];
    await git(worktree, [...identity, 'commit', '-q', '-m', message]);
    return true;
  }

  async diffStat(base: string, branch: string): Promise<DiffStat[]> {
    return parseNumstat(await git(this.repoRoot, ['diff', '--numstat', `${base}...${branch}`]));
  }

  async remove(agentName: string): Promise<void> {
    await git(this.repoRoot, ['worktree', 'remove', '--force', this.worktreePath(agentName)]).catch(() => undefined);
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/main/git test/worktrees.test.ts && npm run typecheck`
Expected: all PASS. On macOS `os.tmpdir()` is under `/var`, which is a symlink to `/private/var`; `makeRepo` returns the real path, so compare against that.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(git): per-agent worktrees, auto-commit and diff stats

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Task rules (status transitions and the run queue)

**Files:**
- Create: `src/main/agents/taskRules.ts`
- Test: `src/main/agents/taskRules.test.ts`

**Interfaces:**
- Consumes: `Task`, `TaskStatus` (Task 2).
- Produces: `canTransition(from: TaskStatus, to: TaskStatus): boolean`, `assertTransition(task: Task, to: TaskStatus): void`, `runnableTasks(tasks: Task[], busyAgentIds: ReadonlySet<string>, maxConcurrent: number): Task[]`.

- [ ] **Step 1: Write the failing test** — `src/main/agents/taskRules.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { assertTransition, canTransition, runnableTasks } from './taskRules';
import type { Task } from '../../shared/types';

let n = 0;
const t = (over: Partial<Task>): Task => ({
  id: `T-${101 + n}`, projectId: 'p', title: 'x', brief: '', assigneeId: 'a1', createdBy: 'user', status: 'queued',
  held: false, attempts: 0, branch: 'b', dependsOn: [], createdAt: `2026-10-14T10:00:${String(n++).padStart(2, '0')}Z`, updatedAt: '', ...over,
});

describe('transitions', () => {
  it('allows the normal lifecycle and rejects skipping steps', () => {
    expect(canTransition('queued', 'working')).toBe(true);
    expect(canTransition('working', 'review')).toBe(true);
    expect(canTransition('review', 'done')).toBe(true);
    expect(canTransition('queued', 'done')).toBe(false);
    expect(canTransition('done', 'queued')).toBe(false);
    expect(() => assertTransition(t({ id: 'T-9', status: 'done' }), 'working')).toThrow('Task T-9: cannot go from done to working');
  });
});

describe('runnableTasks', () => {
  it('picks oldest first, one task per agent, within the concurrency limit', () => {
    const tasks = [
      t({ id: 'A', assigneeId: 'a1' }),
      t({ id: 'B', assigneeId: 'a1' }),
      t({ id: 'C', assigneeId: 'a2' }),
      t({ id: 'D', assigneeId: 'a3' }),
    ];
    expect(runnableTasks(tasks, new Set(), 2).map((x) => x.id)).toEqual(['A', 'C']);
  });

  it('counts tasks already working against the limit and skips busy agents', () => {
    const tasks = [t({ id: 'W', status: 'working', assigneeId: 'a1' }), t({ id: 'Q1', assigneeId: 'a1' }), t({ id: 'Q2', assigneeId: 'a2' })];
    expect(runnableTasks(tasks, new Set(['a1']), 2).map((x) => x.id)).toEqual(['Q2']);
    expect(runnableTasks(tasks, new Set(['a1']), 1)).toEqual([]);
  });

  it('waits for dependencies to be done, and skips held tasks', () => {
    const tasks = [
      t({ id: 'D1', status: 'review', assigneeId: 'a1' }),
      t({ id: 'X', assigneeId: 'a2', dependsOn: ['D1'] }),
      t({ id: 'H', assigneeId: 'a3', held: true }),
    ];
    expect(runnableTasks(tasks, new Set(), 4)).toEqual([]);
    tasks[0].status = 'done';
    expect(runnableTasks(tasks, new Set(), 4).map((x) => x.id)).toEqual(['X']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/main/agents/taskRules.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/main/agents/taskRules.ts`**

```ts
import type { Task, TaskStatus } from '../../shared/types';

const NEXT: Record<TaskStatus, TaskStatus[]> = {
  queued: ['working', 'cancelled'],
  working: ['review', 'needs_help', 'queued', 'cancelled'],
  needs_help: ['queued', 'failed', 'cancelled'],
  review: ['done', 'queued', 'cancelled'],
  done: [],
  failed: [],
  cancelled: [],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return NEXT[from].includes(to);
}

export function assertTransition(task: Task, to: TaskStatus): void {
  if (!canTransition(task.status, to)) throw new Error(`Task ${task.id}: cannot go from ${task.status} to ${to}`);
}

export function runnableTasks(tasks: Task[], busyAgentIds: ReadonlySet<string>, maxConcurrent: number): Task[] {
  const done = new Set(tasks.filter((t) => t.status === 'done').map((t) => t.id));
  let slots = maxConcurrent - tasks.filter((t) => t.status === 'working').length;
  const claimed = new Set(busyAgentIds);
  const picked: Task[] = [];
  const queued = tasks.filter((t) => t.status === 'queued' && !t.held).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const t of queued) {
    if (slots <= 0) break;
    if (claimed.has(t.assigneeId)) continue;
    if (!t.dependsOn.every((d) => done.has(d))) continue;
    picked.push(t);
    claimed.add(t.assigneeId);
    slots--;
  }
  return picked;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/main/agents/taskRules.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(tasks): status transitions and dependency-aware run queue

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: AgentManager

**Files:**
- Create: `src/main/agents/agentManager.ts`
- Test: `test/agentManager.test.ts`

**Interfaces:**
- Consumes: everything above — `ProjectStore`, `nextTaskId`, `dataPaths` (Task 2); `RoleStore`, `SkillStore`, `renderPrompt`, `taskMessage` (Task 3); `reduceStatus` (Task 4); `ClaudeLaunch` (Task 5); `AgentRunner`, `ClaudeRunnerOptions`, `ClaudeRunner` (Task 6); `WorktreeManager`, `slugify` (Task 7); `assertTransition`, `runnableTasks` (Task 8).
- Produces (used by Plan 2's MCP tools and Plan 3's UI):

```ts
export interface AgentManagerDeps {
  project: Project;
  store: ProjectStore;
  roles: RoleStore;
  skills: SkillStore;
  worktrees: WorktreeManager;
  createRunner: (o: ClaudeRunnerOptions) => AgentRunner;
  claudeBin: string;
  promptDir: string;
  isolateUserSettings: boolean;
  now?: () => Date;
}
export type ManagerEvent =
  | { type: 'agent-event'; agentId: string; event: RunnerEvent }
  | { type: 'agents-changed' }
  | { type: 'tasks-changed' }
  | { type: 'task-finished'; task: Task; agent: Agent }
  | { type: 'error'; message: string };
export interface NewTask { assignee: string; title: string; brief: string; dependsOn?: string[]; createdBy: 'boss' | 'user' }
export class AgentManager extends EventEmitter {
  constructor(deps: AgentManagerDeps);
  load(): Promise<void>;
  agents(): Agent[];
  tasks(): Task[];
  findAgent(ref: string): Agent | undefined;     // by id or case-insensitive name
  createBoss(name: string): Promise<Agent>;
  hire(roleId: string, name?: string): Promise<Agent>;
  createTask(input: NewTask): Promise<Task>;
  pump(): Promise<void>;
  pauseTask(taskId: string): Promise<void>;
  resumeTask(taskId: string): Promise<void>;
  cancelTask(taskId: string): Promise<void>;
  markDone(taskId: string): Promise<void>;
  idle(): Promise<void>;                          // resolves when queued work has settled (tests)
  shutdown(): Promise<void>;
  on(event: 'event', listener: (e: ManagerEvent) => void): this;
}
```

- [ ] **Step 1: Write the failing tests** — `test/agentManager.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentManager, type ManagerEvent } from '../src/main/agents/agentManager';
import { ClaudeRunner } from '../src/main/claude/runner';
import { WorktreeManager, git } from '../src/main/git/worktrees';
import { dataPaths } from '../src/main/store/paths';
import { ProjectStore } from '../src/main/store/projectStore';
import { RoleStore } from '../src/main/store/roleStore';
import { SkillStore } from '../src/main/store/skillStore';
import type { Project, Task } from '../src/shared/types';
import { makeRepo } from './helpers/repo';
import { FAKE_CLAUDE } from './helpers/runner';

let repo: string;
let data: string;
let argvOut: string;
let fakeEnv: Record<string, string>;
let project: Project;

async function makeManager(maxConcurrent = 4): Promise<AgentManager> {
  const paths = dataPaths(data);
  const roles = new RoleStore(paths.rolesDir);
  const skills = new SkillStore(paths.skillsDir);
  await roles.seed(path.resolve('resources/roles'));
  await skills.seed(path.resolve('resources/skills'));
  project = { id: 'p1', name: 'demo', repoPath: repo, baseBranch: 'main', maxConcurrent, bossCanHire: true, autoMerge: false };
  const m = new AgentManager({
    project, store: new ProjectStore(paths), roles, skills, worktrees: new WorktreeManager(repo),
    createRunner: (o) => new ClaudeRunner({ ...o, bin: process.execPath, binArgs: [FAKE_CLAUDE], env: { ...process.env, ...fakeEnv } }),
    claudeBin: 'claude', promptDir: paths.promptDir, isolateUserSettings: true,
  });
  await m.load();
  return m;
}

function waitFor(m: AgentManager, pred: (e: ManagerEvent) => boolean, ms = 20000): Promise<ManagerEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { m.off('event', l); reject(new Error('timed out')); }, ms);
    const l = (e: ManagerEvent) => { if (pred(e)) { clearTimeout(timer); m.off('event', l); resolve(e); } };
    m.on('event', l);
  });
}
const finished = (m: AgentManager, id: string) => waitFor(m, (e) => e.type === 'task-finished' && e.task.id === id);
const launches = async () => (await fs.readFile(argvOut, 'utf8').catch(() => '')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as { argv: string[] });

beforeEach(async () => {
  repo = await makeRepo();
  data = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-mgr-'));
  argvOut = path.join(data, 'argv.jsonl');
  fakeEnv = { FAKE_CLAUDE_ARGV_OUT: argvOut, FAKE_CLAUDE_FILE: 'notes.txt' };
});
afterEach(async () => {
  await fs.rm(repo, { recursive: true, force: true });
  await fs.rm(data, { recursive: true, force: true });
});

describe('AgentManager', () => {
  it('hires with pool names and rejects duplicates or unknown roles', async () => {
    const m = await makeManager();
    expect((await m.hire('frontend')).name).toBe('Pixel');
    expect((await m.hire('backend')).name).toBe('Byte');
    await expect(m.hire('qa', 'pixel')).rejects.toThrow(/already exists/);
    await expect(m.hire('nope')).rejects.toThrow(/Unknown role/);
    await m.shutdown();
  });

  it('runs a task in a worktree through to review with a diff and summary', async () => {
    const m = await makeManager();
    await m.createBoss('Max');
    const pixel = await m.hire('frontend');
    const done = finished(m, 'T-101');
    const task = await m.createTask({ assignee: 'pixel', title: 'Add theme toggle', brief: 'Make it.', createdBy: 'user' });
    expect(task.branch).toBe('ao/pixel/add-theme-toggle-t-101');
    await done;
    await m.idle();
    const t = m.tasks()[0];
    expect(t.status).toBe('review');
    expect(t.resultSummary).toMatch(/^echo: # Task T-101: Add theme toggle/);
    expect(t.diffStat).toEqual([{ path: 'notes.txt', add: 1, del: 0 }]);
    const agent = m.findAgent(pixel.id)!;
    expect(agent.sessionId).toBeTruthy();
    expect(agent.status).toBe('done');
    const [launch] = await launches();
    expect(launch.argv).toEqual(expect.arrayContaining(['--model', 'sonnet', '--setting-sources', 'project,local', '--append-system-prompt-file']));
    const promptFile = launch.argv[launch.argv.indexOf('--append-system-prompt-file') + 1];
    expect(await fs.readFile(promptFile, 'utf8')).toContain('Your boss is Max.');
    expect(await git(repo, ['status', '--porcelain'])).toBe('');
    await m.shutdown();
  });

  it('resumes the same session for the agent’s next task', async () => {
    const m = await makeManager();
    await m.hire('frontend');
    const first = finished(m, 'T-101');
    await m.createTask({ assignee: 'Pixel', title: 'one', brief: 'a', createdBy: 'user' });
    await first;
    await m.idle();
    const second = finished(m, 'T-102');
    await m.createTask({ assignee: 'Pixel', title: 'two', brief: 'b', createdBy: 'user' });
    await second;
    const [l1, l2] = await launches();
    const sid = l1.argv[l1.argv.indexOf('--session-id') + 1];
    expect(l2.argv).toEqual(expect.arrayContaining(['--resume', sid]));
    await m.shutdown();
  });

  it('never runs more than maxConcurrent sessions at once', async () => {
    fakeEnv.FAKE_CLAUDE_DELAY_MS = '150';
    fakeEnv.FAKE_CLAUDE_FIXTURE = path.resolve('test/fixtures/stream/read-file.jsonl');
    const m = await makeManager(1);
    await m.hire('frontend');
    await m.hire('backend');
    let peak = 0;
    m.on('event', () => { peak = Math.max(peak, m.tasks().filter((t) => t.status === 'working').length); });
    const both = Promise.all([finished(m, 'T-101'), finished(m, 'T-102')]);
    await m.createTask({ assignee: 'Pixel', title: 'a', brief: 'a', createdBy: 'user' });
    await m.createTask({ assignee: 'Byte', title: 'b', brief: 'b', createdBy: 'user' });
    expect(m.tasks().map((t) => t.status)).toEqual(['working', 'queued']);
    await both;
    expect(peak).toBe(1);
    await m.shutdown();
  });

  it('holds a dependent task until its dependency is done', async () => {
    const m = await makeManager();
    await m.hire('frontend');
    await m.hire('qa');
    const first = finished(m, 'T-101');
    await m.createTask({ assignee: 'Pixel', title: 'build', brief: 'x', createdBy: 'boss' });
    await m.createTask({ assignee: 'Quinn', title: 'test it', brief: 'y', dependsOn: ['T-101'], createdBy: 'boss' });
    await first;
    await m.idle();
    expect(m.tasks().find((t) => t.id === 'T-102')!.status).toBe('queued');
    const second = finished(m, 'T-102');
    await m.markDone('T-101');
    await second;
    await m.shutdown();
  });

  it('rejects tasks for unknown agents or unknown dependencies', async () => {
    const m = await makeManager();
    await m.hire('frontend');
    await expect(m.createTask({ assignee: 'Nobody', title: 't', brief: 'b', createdBy: 'user' })).rejects.toThrow(/No employee named Nobody/);
    await expect(m.createTask({ assignee: 'Pixel', title: 't', brief: 'b', dependsOn: ['T-999'], createdBy: 'user' })).rejects.toThrow(/Unknown task T-999/);
    await m.shutdown();
  });

  it('marks a crashed session as needs_help with stderr, then keeps going', async () => {
    fakeEnv.FAKE_CLAUDE_CRASH = '1';
    const m = await makeManager(1);
    await m.hire('frontend');
    await m.hire('backend');
    const crashed = finished(m, 'T-101');
    await m.createTask({ assignee: 'Pixel', title: 'a', brief: 'a', createdBy: 'user' });
    delete fakeEnv.FAKE_CLAUDE_CRASH; // only T-101's runner was created with it
    await m.createTask({ assignee: 'Byte', title: 'b', brief: 'b', createdBy: 'user' });
    await crashed;
    const t1 = m.tasks().find((t) => t.id === 'T-101')!;
    expect(t1.status).toBe('needs_help');
    expect(t1.resultSummary).toContain('boom: simulated crash');
    await finished(m, 'T-102');
    expect(m.tasks().find((t) => t.id === 'T-102')!.status).toBe('review');
    await m.shutdown();
  });

  it('marks an error result as needs_help', async () => {
    fakeEnv.FAKE_CLAUDE_FAIL = '1';
    const m = await makeManager();
    await m.hire('frontend');
    const done = finished(m, 'T-101');
    await m.createTask({ assignee: 'Pixel', title: 'a', brief: 'a', createdBy: 'user' });
    await done;
    expect(m.tasks()[0]).toMatchObject({ status: 'needs_help', resultSummary: 'simulated failure' });
    await m.shutdown();
  });

  it('pauses and resumes a task, continuing the same session', async () => {
    fakeEnv.FAKE_CLAUDE_HANG = '1';
    const m = await makeManager();
    const pixel = await m.hire('frontend');
    const started = waitFor(m, (e) => e.type === 'agent-event' && e.event.type === 'init');
    await m.createTask({ assignee: 'Pixel', title: 'long', brief: 'x', createdBy: 'user' });
    await started;
    await m.pauseTask('T-101');
    await waitFor(m, (e) => e.type === 'agent-event' && e.event.type === 'exit');
    await m.idle();
    expect(m.tasks()[0]).toMatchObject({ status: 'queued', held: true });
    expect(m.findAgent(pixel.id)!.status).toBe('paused');
    delete fakeEnv.FAKE_CLAUDE_HANG;
    const done = finished(m, 'T-101');
    await m.resumeTask('T-101');
    await done;
    const [, l2] = await launches();
    expect(l2.argv).toContain('--resume');
    expect(m.tasks()[0].attempts).toBe(2);
    await m.shutdown();
  });

  it('cancels a running task', async () => {
    fakeEnv.FAKE_CLAUDE_HANG = '1';
    const m = await makeManager();
    await m.hire('frontend');
    const started = waitFor(m, (e) => e.type === 'agent-event' && e.event.type === 'init');
    await m.createTask({ assignee: 'Pixel', title: 'long', brief: 'x', createdBy: 'user' });
    await started;
    await m.cancelTask('T-101');
    await waitFor(m, (e) => e.type === 'agent-event' && e.event.type === 'exit');
    await m.idle();
    expect(m.tasks()[0].status).toBe('cancelled');
    await m.shutdown();
  });

  it('after a restart, re-queues tasks left working and runs each exactly once', async () => {
    const m1 = await makeManager();
    const pixel = await m1.hire('frontend');
    await m1.shutdown();
    const store = new ProjectStore(dataPaths(data));
    const stale: Task = {
      id: 'T-101', projectId: 'p1', title: 'stale', brief: 'x', assigneeId: pixel.id, createdBy: 'user', status: 'working',
      held: false, attempts: 1, branch: 'ao/pixel/stale-t-101', dependsOn: [], createdAt: '2026-10-14T10:00:00Z', updatedAt: '2026-10-14T10:00:00Z',
    };
    await store.saveTasks('p1', [stale]);
    const m2 = await makeManager();
    expect(m2.tasks()[0].status).toBe('queued');
    const done = finished(m2, 'T-101');
    await m2.pump();
    await done;
    await m2.idle();
    expect(await launches()).toHaveLength(1);
    expect(m2.tasks()[0].status).toBe('review');
    await m2.shutdown();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run test/agentManager.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/main/agents/agentManager.ts`**

```ts
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Agent, Project, RunnerEvent, Task, TaskStatus } from '../../shared/types';
import type { AgentRunner, ClaudeRunnerOptions } from '../claude/runner';
import { reduceStatus } from '../claude/status';
import { WorktreeManager, slugify } from '../git/worktrees';
import type { ProjectStore } from '../store/projectStore';
import { nextTaskId } from '../store/projectStore';
import type { RoleStore } from '../store/roleStore';
import type { SkillStore } from '../store/skillStore';
import { renderPrompt, taskMessage } from './prompt';
import { assertTransition, runnableTasks } from './taskRules';

export interface AgentManagerDeps {
  project: Project;
  store: ProjectStore;
  roles: RoleStore;
  skills: SkillStore;
  worktrees: WorktreeManager;
  createRunner: (o: ClaudeRunnerOptions) => AgentRunner;
  claudeBin: string;
  promptDir: string;
  isolateUserSettings: boolean;
  now?: () => Date;
}

export type ManagerEvent =
  | { type: 'agent-event'; agentId: string; event: RunnerEvent }
  | { type: 'agents-changed' }
  | { type: 'tasks-changed' }
  | { type: 'task-finished'; task: Task; agent: Agent }
  | { type: 'error'; message: string };

export interface NewTask { assignee: string; title: string; brief: string; dependsOn?: string[]; createdBy: 'boss' | 'user' }

interface Live { runner: AgentRunner; taskId: string }

const NAME_POOL = ['Pixel', 'Byte', 'Quinn', 'Ivy', 'Nova', 'Rex', 'Juno', 'Sage', 'Kit', 'Ziggy', 'Milo', 'Tess'];
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class AgentManager extends EventEmitter {
  private agentList: Agent[] = [];
  private taskList: Task[] = [];
  private live = new Map<string, Live>();
  /** All mutations run one at a time through this chain. */
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly d: AgentManagerDeps) {
    super();
  }

  // ---------- reads ----------

  agents(): Agent[] { return this.agentList.map((a) => ({ ...a })); }
  tasks(): Task[] { return this.taskList.map((t) => ({ ...t })); }

  findAgent(ref: string): Agent | undefined {
    const r = ref.trim().toLowerCase();
    return this.agentList.find((a) => a.id === ref || a.name.toLowerCase() === r);
  }

  // ---------- lifecycle ----------

  async load(): Promise<void> {
    this.agentList = await this.d.store.getAgents(this.d.project.id);
    this.taskList = await this.d.store.getTasks(this.d.project.id);
    for (const a of this.agentList) { a.status = 'idle'; a.bubble = 'Idle'; }
    let changed = false;
    for (const t of this.taskList) {
      if (t.status === 'working') { t.status = 'queued'; t.updatedAt = this.now(); changed = true; }
    }
    if (changed) await this.saveTasks();
  }

  idle(): Promise<void> { return this.chain; }

  async shutdown(): Promise<void> {
    for (const { runner } of this.live.values()) runner.stop();
    await this.chain;
  }

  // ---------- commands ----------

  createBoss(name: string): Promise<Agent> {
    return this.run(async () => {
      const existing = this.agentList.find((a) => a.kind === 'boss');
      if (existing) return { ...existing };
      const boss: Agent = { id: randomUUID(), projectId: this.d.project.id, name: name.trim() || 'Max', roleId: 'boss', kind: 'boss', status: 'idle', bubble: 'Idle' };
      this.agentList.push(boss);
      await this.saveAgents();
      return { ...boss };
    });
  }

  hire(roleId: string, name?: string): Promise<Agent> {
    return this.run(async () => {
      const role = await this.d.roles.get(roleId);
      if (!role) throw new Error(`Unknown role: ${roleId}`);
      const taken = new Set(this.agentList.map((a) => a.name.toLowerCase()));
      const finalName = name?.trim() || NAME_POOL.find((n) => !taken.has(n.toLowerCase())) || `${role.name} ${this.agentList.length + 1}`;
      if (taken.has(finalName.toLowerCase())) throw new Error(`An agent named ${finalName} already exists`);
      const agent: Agent = { id: randomUUID(), projectId: this.d.project.id, name: finalName, roleId, kind: 'employee', status: 'idle', bubble: 'Idle' };
      this.agentList.push(agent);
      await this.saveAgents();
      return { ...agent };
    });
  }

  async createTask(input: NewTask): Promise<Task> {
    const task = await this.run(async () => {
      const agent = this.findAgent(input.assignee);
      if (!agent || agent.kind !== 'employee') throw new Error(`No employee named ${input.assignee}`);
      for (const dep of input.dependsOn ?? []) {
        if (!this.taskList.some((t) => t.id === dep)) throw new Error(`Unknown task ${dep}`);
      }
      const id = nextTaskId(this.taskList);
      const now = this.now();
      const t: Task = {
        id, projectId: this.d.project.id, title: input.title.trim(), brief: input.brief, assigneeId: agent.id, createdBy: input.createdBy,
        status: 'queued', held: false, attempts: 0, branch: `ao/${slugify(agent.name)}/${slugify(input.title, 'task')}-${id.toLowerCase()}`,
        dependsOn: input.dependsOn ?? [], createdAt: now, updatedAt: now,
      };
      this.taskList.push(t);
      await this.saveTasks();
      return { ...t };
    });
    await this.pump();
    return task;
  }

  pump(): Promise<void> {
    return this.run(async () => {
      for (const t of runnableTasks(this.taskList, new Set(this.live.keys()), this.d.project.maxConcurrent)) {
        try {
          await this.startTask(t);
        } catch (e) {
          if (t.status === 'queued') this.setStatus(t, 'working');
          this.setStatus(t, 'needs_help', { resultSummary: `Could not start: ${msg(e)}` });
          await this.saveTasks();
          this.emitEvent({ type: 'error', message: `${t.id}: ${msg(e)}` });
        }
      }
    });
  }

  pauseTask(taskId: string): Promise<void> {
    return this.run(async () => {
      const t = this.mustTask(taskId);
      if (t.status !== 'working') throw new Error(`Task ${taskId} is not running`);
      t.held = true;
      this.setStatus(t, 'queued');
      const agent = this.mustAgent(t.assigneeId);
      agent.status = 'paused';
      agent.bubble = 'Paused';
      await this.saveTasks();
      await this.saveAgents();
      this.live.get(agent.id)?.runner.stop();
    });
  }

  async resumeTask(taskId: string): Promise<void> {
    await this.run(async () => {
      const t = this.mustTask(taskId);
      t.held = false;
      t.updatedAt = this.now();
      await this.saveTasks();
      this.emitEvent({ type: 'tasks-changed' });
    });
    await this.pump();
  }

  cancelTask(taskId: string): Promise<void> {
    return this.run(async () => {
      const t = this.mustTask(taskId);
      const wasWorking = t.status === 'working';
      this.setStatus(t, 'cancelled');
      await this.saveTasks();
      if (wasWorking) this.live.get(t.assigneeId)?.runner.stop();
    });
  }

  async markDone(taskId: string): Promise<void> {
    await this.run(async () => {
      this.setStatus(this.mustTask(taskId), 'done');
      await this.saveTasks();
    });
    await this.pump();
  }

  // ---------- internals ----------

  private async startTask(task: Task): Promise<void> {
    const agent = this.mustAgent(task.assigneeId);
    const role = await this.d.roles.get(agent.roleId);
    if (!role) throw new Error(`Role ${agent.roleId} is missing`);
    const wt = await this.d.worktrees.prepare(agent.name, task.branch, this.d.project.baseBranch);
    agent.worktreePath = wt;
    agent.status = 'thinking';
    agent.bubble = 'Starting…';

    const boss = this.agentList.find((a) => a.kind === 'boss');
    const skills = await this.d.skills.getMany(role.skills);
    const promptFile = path.join(this.d.promptDir, `${agent.id}.md`);
    await fs.mkdir(this.d.promptDir, { recursive: true });
    await fs.writeFile(promptFile, renderPrompt(role, skills, {
      agentName: agent.name, bossName: boss?.name ?? 'the boss', branch: task.branch, projectName: this.d.project.name, kind: 'employee',
    }));

    const runner = this.d.createRunner({
      bin: this.d.claudeBin,
      cwd: wt,
      launch: {
        model: role.model,
        permissionMode: role.permissionMode,
        allowedTools: role.allowedTools,
        appendSystemPromptFile: promptFile,
        resume: agent.sessionId,
        sessionId: agent.sessionId ? undefined : randomUUID(),
        isolateUserSettings: this.d.isolateUserSettings,
      },
    });
    this.live.set(agent.id, { runner, taskId: task.id });
    // Errors are already reported as { type: 'error' } by run(); swallow here to avoid unhandled rejections.
    runner.on('event', (ev) => { this.run(() => this.onRunnerEvent(agent.id, task.id, runner, ev)).catch(() => undefined); });

    const message = taskMessage(task);
    this.setStatus(task, 'working', { attempts: task.attempts + 1 });
    await this.saveTasks();
    runner.start();
    if (runner.running) runner.send(message);
  }

  private async onRunnerEvent(agentId: string, taskId: string, runner: AgentRunner, ev: RunnerEvent): Promise<void> {
    const agent = this.mustAgent(agentId);
    const task = this.taskList.find((t) => t.id === taskId);
    await this.d.store.appendLog(this.d.project.id, agentId, { at: this.now(), taskId, event: ev });

    if (ev.type === 'init' && ev.sessionId) agent.sessionId = ev.sessionId;
    if (agent.status !== 'paused') Object.assign(agent, reduceStatus(agent, ev));
    if (ev.type === 'exit' && task?.status === 'cancelled') { agent.status = 'idle'; agent.bubble = 'Idle'; }
    this.emitEvent({ type: 'agent-event', agentId, event: ev });
    this.emitEvent({ type: 'agents-changed' });

    if (ev.type === 'result') {
      runner.endInput();
      if (task?.status === 'working') await this.finishTask(agent, task, ev.ok, ev.text);
    }

    if (ev.type === 'exit') {
      if (this.live.get(agentId)?.runner === runner) this.live.delete(agentId);
      if (task?.status === 'working') {
        const tail = runner.lastStderr;
        await this.finishTask(agent, task, false, `The session exited (code ${ev.code ?? ev.signal}) before finishing.${tail ? `\n${tail}` : ''}`);
      }
      await this.saveAgents();
      // Start whatever was waiting on this agent or on a free slot (queued after this handler).
      this.pump().catch(() => undefined);
    }
  }

  private async finishTask(agent: Agent, task: Task, ok: boolean, text: string): Promise<void> {
    this.setStatus(task, ok ? 'review' : 'needs_help', { resultSummary: text.trim() });
    try {
      if (agent.worktreePath) await this.d.worktrees.commitAll(agent.worktreePath, `${task.id}: ${task.title}\n\nCommitted by AgentOffice for ${agent.name}.`);
      task.diffStat = await this.d.worktrees.diffStat(this.d.project.baseBranch, task.branch);
    } catch (e) {
      task.resultSummary = `${task.resultSummary}\n(Could not read the changes: ${msg(e)})`;
    }
    await this.saveTasks();
    this.emitEvent({ type: 'task-finished', task: { ...task }, agent: { ...agent } });
  }

  private setStatus(task: Task, to: TaskStatus, patch: Partial<Task> = {}): void {
    assertTransition(task, to);
    Object.assign(task, patch, { status: to, updatedAt: this.now() });
    this.emitEvent({ type: 'tasks-changed' });
  }

  private run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.chain.then(fn);
    this.chain = result.then(() => undefined, (e) => { this.emitEvent({ type: 'error', message: msg(e) }); });
    return result;
  }

  private mustAgent(id: string): Agent {
    const a = this.agentList.find((x) => x.id === id);
    if (!a) throw new Error(`Unknown agent ${id}`);
    return a;
  }

  private mustTask(id: string): Task {
    const t = this.taskList.find((x) => x.id === id);
    if (!t) throw new Error(`Unknown task ${id}`);
    return t;
  }

  private async saveAgents(): Promise<void> {
    await this.d.store.saveAgents(this.d.project.id, this.agentList);
    this.emitEvent({ type: 'agents-changed' });
  }

  private saveTasks(): Promise<void> {
    return this.d.store.saveTasks(this.d.project.id, this.taskList);
  }

  private emitEvent(e: ManagerEvent): void {
    this.emit('event', e);
  }

  private now(): string {
    return (this.d.now?.() ?? new Date()).toISOString();
  }
}
```

Notes for the implementer:
- `run()` serializes every state change, so runner events, timers and API calls never interleave halfway through an update. Never `await` a `run()` call from inside another `run()` callback; that deadlocks. The exit handler calls `this.pump()` without awaiting it for this reason.
- `idle()` returns the current end of the chain. Tests call it after a `task-finished` event so follow-up work (the exit handler, the next `pump`) has settled.
- A failed `run()` rejects for its caller and also emits `{ type: 'error' }`, but does not break the chain.
- When the "could not start" path runs, the task is still `queued`. Moving it through `working` keeps every transition legal.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/agentManager.test.ts && npm run typecheck`
Expected: all PASS. If a test times out, add `m.on('event', (e) => e.type === 'error' && console.error(e.message))` temporarily to see the failure, and check the agent log in `<data>/projects/p1/logs/`.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: every test file PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(agents): AgentManager runs tasks as Claude Code sessions in worktrees

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Show Claude Code status in the app

**Files:**
- Create: `src/main/appStatus.ts`
- Modify: `src/shared/ipc.ts`, `src/main/index.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/styles.css`
- Test: `src/main/appStatus.test.ts`

**Interfaces:**
- Consumes: `locateClaude`, `claudeVersion`, `systemLocateEnv`, `LocateEnv` (Task 5); `fixGuiPath` (Task 5); `AppStatus` (Task 2).
- Produces: `getAppStatus(deps?: { locate: LocateEnv; override?: string; version: (bin: string) => string | null }): AppStatus`; `AgentOfficeApi.getStatus(): Promise<AppStatus>`.

- [ ] **Step 1: Write the failing test** — `src/main/appStatus.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { getAppStatus } from './appStatus';

const locate = (files: string[]) => ({ platform: 'linux' as const, env: { PATH: '/usr/bin' }, home: '/home/u', isFile: (p: string) => files.includes(p) });

describe('getAppStatus', () => {
  it('reports the binary and version when found', () => {
    expect(getAppStatus({ locate: locate(['/usr/bin/claude']), version: () => '2.1.299' })).toEqual({
      platform: 'linux', claude: { path: '/usr/bin/claude', version: '2.1.299' },
    });
  });

  it('reports null when Claude Code is missing', () => {
    expect(getAppStatus({ locate: locate([]), version: () => '1.0.0' })).toEqual({ platform: 'linux', claude: null });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/main/appStatus.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/main/appStatus.ts`**

```ts
import type { AppStatus } from '../shared/types';
import { claudeVersion, locateClaude, systemLocateEnv, type LocateEnv } from './claude/locate';

export interface AppStatusDeps {
  locate: LocateEnv;
  override?: string;
  version: (bin: string) => string | null;
}

export function getAppStatus(deps: AppStatusDeps = { locate: systemLocateEnv(), version: claudeVersion }): AppStatus {
  const bin = locateClaude(deps.locate, deps.override);
  return { platform: deps.locate.platform, claude: bin ? { path: bin, version: deps.version(bin) } : null };
}
```

- [ ] **Step 4: Wire it through IPC**

`src/shared/ipc.ts`:
```ts
import type { AppStatus } from './types';

export const IPC = {
  appStatus: 'app:status',
} as const;

export interface AgentOfficeApi {
  getStatus(): Promise<AppStatus>;
}
```

In `src/main/index.ts`, add the imports and register the handler before creating the window:
```ts
import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { IPC } from '../shared/ipc';
import { getAppStatus } from './appStatus';
import { fixGuiPath } from './claude/shellPath';
```
```ts
app.whenReady().then(() => {
  fixGuiPath();
  ipcMain.handle(IPC.appStatus, () => getAppStatus());
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
```

`src/renderer/src/App.tsx`:
```tsx
import { useEffect, useState } from 'react';
import type { AppStatus } from '../../shared/types';

export function App() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.agentOffice.getStatus().then(setStatus, (e: unknown) => setError(String(e)));
  }, []);

  return (
    <main className="boot">
      <h1>AgentOffice</h1>
      {error && <p className="bad">Could not check for Claude Code: {error}</p>}
      {!status && !error && <p>Looking for Claude Code…</p>}
      {status?.claude && (
        <p className="ok">
          Claude Code {status.claude.version ?? '(unknown version)'} found at <code>{status.claude.path}</code>
        </p>
      )}
      {status && !status.claude && (
        <div className="bad">
          <p>Claude Code was not found on this computer.</p>
          <p>Install it, sign in with <code>claude</code> once in a terminal, then restart AgentOffice.</p>
        </div>
      )}
    </main>
  );
}
```

Append to `src/renderer/src/styles.css`:
```css
.ok { color: #8bd47a; }
.bad { color: #ff9a8e; }
code { font-family: ui-monospace, monospace; background: #1f2130; padding: 2px 6px; border-radius: 4px; color: #ece8df; }
```

- [ ] **Step 5: Run tests, typecheck and build**

Run: `npm test && npm run typecheck && npm run build`
Expected: all PASS; build succeeds.

- [ ] **Step 6: Manually confirm**

Run: `npm run dev`
Expected: the window shows "Claude Code 2.1.x found at …/claude". Then temporarily launch with the CLI hidden (`PATH=/usr/bin:/bin HOME=/tmp npm run dev` on macOS/Linux) and confirm the "not found" message appears.

- [ ] **Step 7: Commit and push**

```bash
git add -A
git commit -m "feat(app): detect Claude Code at startup and show it in the window

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```
Then check the CI run passes on all three OSes: `GH_TOKEN=$(gh auth token --user leoAnimesh) gh run watch --repo leoAnimesh/agent-office`. If Windows or Linux fails, fix it before calling the plan done.

---

## Spec coverage (Plan 1)

| Spec section | Covered by |
|---|---|
| §3 architecture, stack | Task 1 |
| §4 domain model, persistence | Tasks 2, 3 |
| §5 ClaudeRunner, StreamParser, status derivation, CLI detection, AgentRunner interface | Tasks 4, 5, 6, 10 |
| §5 employees: worktrees, resume, completion, diff stat, auto-commit | Tasks 7, 9 |
| §5 concurrency, pause, cancel, restart recovery | Tasks 8, 9 |
| §7 skills rendering | Task 3 |
| §9 errors (missing CLI, crash → needs_help), renderer hardening | Tasks 1, 6, 9, 10 |
| §9a cross-platform (PATHEXT, GUI PATH, tree kill, long paths, CRLF, CI matrix) | Tasks 1, 4, 5, 6, 7 |
| §10 unit + integration tests with fake claude | Tasks 2–10 |
| §5 Boss session, §6 MCP tools, boss notification on finish, `message_agent` resume | **Plan 2** |
| §8 UI screens, merge approvals, settings, packaging, E2E smoke | **Plan 3** |
