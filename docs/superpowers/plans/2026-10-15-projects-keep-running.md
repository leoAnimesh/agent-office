# Projects Keep Running Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switching projects no longer stops the project you leave; every opened project keeps running until it is closed or the app quits, and the sidebar shows what background projects are doing.

**Architecture:** `ProjectService` keeps a `running` map of workspaces next to the active one (`ws`). `open()` reuses a running workspace or opens a new one without closing the active one. Events reach the window only for the active project; a throttled `open-projects` event carries every running project's activity for the sidebar. `close()` closes only the active project; `closeAll()` (app quit) closes them all.

**Tech Stack:** TypeScript, Electron, React, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-15-projects-keep-running-design.md`

## Global Constraints

- Background projects keep their sessions, dev servers, browser tabs, devices and terminals; nothing about them is re-queued on a switch.
- Only the active project's events go to the window (`emitWs`), except `open-projects`.
- `open-projects` is throttled to at most one per second: `{ type: 'open-projects', projects: { id: string; working: number; needsYou: number }[] }` (`working` = tasks in `working`; `needsYou` = pending merge approvals + `needs_help` tasks).
- App quit calls `closeAll()` and waits for it.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Gates: `npm run typecheck && npm test && npm run test:e2e`.

## Review Focus

1. A merge approval answered while its project is in the background must still merge (today `onDecision` drops answers when `this.ws !== ws`). Pinned in Task 1.
2. A failed open of a new project leaves the active project running and active. Pinned in Task 1.
3. Opening the already-active project again returns its snapshot without restarting anything. Pinned in Task 1.

---

### Task 1: Several running workspaces in `ProjectService`

**Files:**
- Modify: `src/main/workspace/projectService.ts`
- Modify: `src/main/index.ts` (`before-quit` → `closeAll()`; IPC `openProjects`)
- Modify: `src/shared/types.ts` (`OpenProjectStatus`, `WorkspaceEvent` `open-projects`), `src/shared/ipc.ts`, `src/preload/index.ts`
- Modify: `src/renderer/src/state.ts` (ignore `open-projects` in the reducer)
- Test: `test/projectService.test.ts`

**Interfaces:**
- Produces: `ProjectService.openProjects(): OpenProjectStatus[]`, `ProjectService.closeAll(): Promise<void>`, `interface OpenProjectStatus { id: string; working: number; needsYou: number }`, IPC `openProjects`.

- [ ] **Step 1: Write the failing tests** (append inside `describe('ProjectService', …)` of `test/projectService.test.ts`; the file's `repo`, `svc`, `events`, `fakeEnv`, `until`, `tool` helpers are used; add `import { makeRepo } from './helpers/repo';` if missing)

```ts
  it('keeps a project running in the background when another one is opened', async () => {
    fakeEnv.FAKE_CLAUDE_HANG = '1';
    const a = await svc.open(repo);
    await tool('hire', { role_id: 'frontend' });
    await tool('assign_task', { agent: 'Pixel', title: 'Long job', brief: 'take your time' });
    await until((e) => e.type === 'tasks' && e.tasks.some((t) => t.status === 'working'));
    const other = await makeRepo();
    try {
      const b = await svc.open(other);
      expect(b.project.id).not.toBe(a.project.id);
      expect(svc.openProjects()).toEqual(expect.arrayContaining([{ id: a.project.id, working: 1, needsYou: 0 }, { id: b.project.id, working: 0, needsYou: 0 }]));
      events.length = 0;
      const back = await svc.open(repo);
      expect(back.tasks.find((t) => t.title === 'Long job')).toMatchObject({ status: 'working', attempts: 1 });
      expect(events.some((e) => e.type === 'agents' || e.type === 'tasks')).toBe(false); // nothing restarted
      await svc.close(); // closes only the active project (A)
      expect(svc.openProjects().map((p) => p.id)).toEqual([b.project.id]);
      await svc.closeAll();
      expect(svc.openProjects()).toEqual([]);
    } finally {
      delete fakeEnv.FAKE_CLAUDE_HANG;
      await fs.rm(other, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });

  it('keeps the active project when opening another one fails', async () => {
    const a = await svc.open(repo);
    await expect(svc.open(path.join(os.tmpdir(), 'not-a-repo-' + Date.now()))).rejects.toThrow();
    expect(svc.current()?.id).toBe(a.project.id);
    expect((await svc.snapshot()).project.id).toBe(a.project.id);
  });

  it('merges a task approved while its project is in the background', async () => {
    const a = await svc.open(repo);
    await tool('hire', { role_id: 'frontend' });
    await tool('assign_task', { agent: 'Pixel', title: 'Notes', brief: 'write notes' });
    await until((e) => e.type === 'tasks' && e.tasks.some((t) => t.status === 'review'));
    await tool('request_merge', { task_id: 'T-101' });
    const req = (await svc.snapshot()).merges[0];
    const other = await makeRepo();
    try {
      await svc.open(other);
      expect(svc.openProjects().find((p) => p.id === a.project.id)).toMatchObject({ needsYou: 1 });
      await svc.open(repo);
      await svc.answerMerge(req.requestId, true);
      await until((e) => e.type === 'tasks' && e.tasks.some((t) => t.id === 'T-101' && t.status === 'done'));
    } finally {
      await fs.rm(other, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run test/projectService.test.ts -t "background|fails|approved"`
Expected: FAIL — `svc.openProjects is not a function`.

- [ ] **Step 3: Implement**

In `ProjectService`:
- add `private running = new Map<string, Workspace>();` and `private activityTimer: ReturnType<typeof setTimeout> | null = null;`
- `open()`: replace `await this.close();` + the id line with:

```ts
    const id = projectIdFor(info.root);
    // Already running (in the background or active): just show it.
    const running = this.running.get(id);
    if (running) {
      this.ws = running;
      this.activityChanged();
      return this.snapshot();
    }
```

  and where the workspace is installed (`this.ws = ws;`) add `this.running.set(id, ws);` before it and `this.activityChanged();` after it.
- `close()` becomes:

```ts
  /** Close the project in view (others keep running). */
  async close(): Promise<void> {
    const ws = this.ws;
    if (!ws) return;
    this.ws = null;
    await this.closeWorkspace(ws);
  }

  /** App quit: close every running project. */
  async closeAll(): Promise<void> {
    this.ws = null;
    await Promise.all([...this.running.values()].map((ws) => this.closeWorkspace(ws)));
  }

  private async closeWorkspace(ws: Workspace): Promise<void> {
    this.running.delete(ws.project.id);
    this.activityChanged();
    ws.broker.rejectAll();
    await this.terminals?.kill(ws.project.id);
    await ws.boss.stop();
    await ws.manager.shutdown();
    await ws.devServers.close();
    await ws.browser.close();
    await ws.devices.close();
    await ws.office.close();
    await ws.host.close();
  }
```

- `onDecision`: `if (this.ws !== ws) return null;` becomes `if (!this.running.has(ws.project.id)) return null;` (a closed project keeps its saved requests; a background one acts on the answer).
- Activity:

```ts
  /** Every running project's activity, for the sidebar. */
  openProjects(): OpenProjectStatus[] {
    return [...this.running.values()].map((ws) => {
      const tasks = ws.manager.tasks();
      return {
        id: ws.project.id,
        working: tasks.filter((t) => t.status === 'working').length,
        needsYou: ws.broker.pending().length + tasks.filter((t) => t.status === 'needs_help').length,
      };
    });
  }

  /** At most once a second, whichever project changed (background ones too). */
  private activityChanged(): void {
    if (this.activityTimer) return;
    this.activityTimer = setTimeout(() => {
      this.activityTimer = null;
      this.emit('event', { type: 'open-projects', projects: this.openProjects() } satisfies WorkspaceEvent);
    }, 1000);
  }
```

  and call `this.activityChanged()` at the top of `forward()` for `tasks-changed`, `task-finished` and `agents-changed`, and in `requestMerge` / `onDecision` after the broker changes.

`src/shared/types.ts`: `export interface OpenProjectStatus { id: string; working: number; needsYou: number }` and `WorkspaceEvent` gains `| { type: 'open-projects'; projects: OpenProjectStatus[] }`. `state.ts` `applyEvent`: `case 'open-projects': return s;`.

IPC: `openProjects: 'project:running'`, `AgentOfficeApi.openProjects(): Promise<OpenProjectStatus[]>`; preload; `index.ts`: `handle(IPC.openProjects, () => svc.openProjects());` and `before-quit` uses `service.closeAll()`.

- [ ] **Step 4: Run them**

Run: `npx vitest run test/projectService.test.ts test/projectService.ui.test.ts && npm run typecheck`
Expected: PASS; then `npm test` all pass.

- [ ] **Step 5: Commit**

```bash
git add src test
git commit -m "feat(projects): keep every opened project running when you switch"
```

---

### Task 2: Sidebar shows background activity

**Files:**
- Create: `src/renderer/src/components/sidebarStatus.ts` + test
- Modify: `src/renderer/src/components/Sidebar.tsx`, `src/renderer/src/styles/app.css`
- Modify: `e2e/smoke.spec.ts`

**Interfaces:**
- Produces: `projectStatus(s: OpenProjectStatus | undefined): { running: boolean; text: string; attention: boolean }`.

- [ ] **Step 1: Failing test** `src/renderer/src/components/sidebarStatus.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { projectStatus } from './sidebarStatus';

describe('projectStatus', () => {
  it('says what a running project is doing', () => {
    expect(projectStatus(undefined)).toEqual({ running: false, text: '', attention: false });
    expect(projectStatus({ id: 'a', working: 0, needsYou: 0 })).toEqual({ running: true, text: 'running', attention: false });
    expect(projectStatus({ id: 'a', working: 2, needsYou: 0 })).toEqual({ running: true, text: '2 working', attention: false });
    expect(projectStatus({ id: 'a', working: 1, needsYou: 1 })).toEqual({ running: true, text: 'needs you', attention: true });
  });
});
```

- [ ] **Step 2: Run it** — `npx vitest run src/renderer/src/components/sidebarStatus.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
import type { OpenProjectStatus } from '../../../shared/types';

/** The sidebar note for a project: running in the background, how many are working, or that it needs you. */
export function projectStatus(s: OpenProjectStatus | undefined): { running: boolean; text: string; attention: boolean } {
  if (!s) return { running: false, text: '', attention: false };
  if (s.needsYou > 0) return { running: true, text: 'needs you', attention: true };
  return { running: true, text: s.working > 0 ? `${s.working} working` : 'running', attention: false };
}
```

`Sidebar.tsx`: keep `const [running, setRunning] = useState<OpenProjectStatus[]>([]);`, load it with `window.agentOffice.openProjects()` on mount and on `current.id` change, and subscribe `window.agentOffice.onEvent((e) => { if (e.type === 'open-projects') setRunning(e.projects); })`. For each project that is not current: `const st = projectStatus(running.find((r) => r.id === p.id));` the dot is `var(--green)` when `st.running`, and after the label render `{st.text && <span className={st.attention ? 'side-note attention' : 'side-note'}>{st.text}</span>}`.

`app.css`: `.side-note { margin-left: auto; font-size: 11px; color: var(--muted); white-space: nowrap; } .side-note.attention { color: var(--amber); font-weight: 600; }`

- [ ] **Step 4: e2e** (add to `e2e/smoke.spec.ts`)

```ts
test('switching projects keeps the other project working', async () => {
  const a = await makeRepo();
  const b = await makeRepo();
  const env = { AO_CLAUDE_BIN: process.execPath, AO_CLAUDE_ARGS: JSON.stringify([FAKE]), AO_E2E_PICK_FOLDER: a, FAKE_CLAUDE_HANG: '1' };
  let { app, userData } = await launch(env);
  try {
    let win = await app.firstWindow();
    await win.getByRole('button', { name: 'Browse' }).click();
    await win.getByRole('button', { name: /Open the office/ }).click();
    await expect(win.getByRole('button', { name: /^Max, Boss/ })).toBeVisible();
    await app.close();
    const pdir = await seedTeam(userData, [{ name: 'Pixel', roleId: 'frontend' }]);
    const pixel = (JSON.parse(await fs.readFile(path.join(pdir, 'agents.json'), 'utf8')) as { id: string; name: string }[]).find((x) => x.name === 'Pixel')!;
    const now = new Date().toISOString();
    await fs.writeFile(path.join(pdir, 'tasks.json'), JSON.stringify([{ id: 'T-101', projectId: path.basename(pdir), title: 'Long job', brief: 'x', assigneeId: pixel.id, createdBy: 'boss', status: 'queued', held: false, attempts: 0, branch: 'ao/pixel/long-t-101', dependsOn: [], createdAt: now, updatedAt: now, model: 'haiku' }]));
    ({ app, win } = await reopen(env, userData));
    await expect(win.locator('.task-card, .desk').first()).toBeVisible();
    // Open project B through the "New project" → Browse flow is not needed: the picker hook returns B now.
    await app.close();
    ({ app } = await launch({ ...env, AO_E2E_PICK_FOLDER: b }, userData));
    win = await app.firstWindow();
    // (the app reopens A on launch; open B from the onboarding picker in the sidebar's New project)
    await win.getByRole('button', { name: 'New project' }).click();
    await win.getByRole('button', { name: 'Browse' }).click();
    await win.getByRole('button', { name: /Open the office/ }).click();
    const sideA = win.getByRole('navigation', { name: 'Projects and library' }).getByRole('button', { name: new RegExp(path.basename(a)) });
    await expect(sideA).toContainText('1 working', { timeout: 15_000 });
    await sideA.click();
    await win.getByRole('navigation', { name: 'Project views' }).getByRole('button', { name: /^Tasks/ }).click();
    await expect(win.getByRole('region', { name: 'Working' }).getByText('Long job')).toBeVisible();
  } finally {
    await app.close();
    for (const d of [a, b, userData]) await fs.rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
```

(Adjust the selectors to what the New project screen and the task board actually show — check `Onboarding.tsx` for the open-existing button and `TaskBoard.tsx` for the column region names before running.)

- [ ] **Step 5: Gates and commit**

Run: `npm run typecheck && npm test && npm run test:e2e` → all pass.

```bash
git add src e2e
git commit -m "feat(sidebar): show what background projects are doing"
```
