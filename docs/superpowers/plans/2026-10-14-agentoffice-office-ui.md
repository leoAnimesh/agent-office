# AgentOffice Office UI, Settings & Packaging — Implementation Plan (Plan 3 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the working engine into the app from the design canvas: a pixel-art office where agents animate at their desks, an agent detail page with the live session, a styled task board, a team and role editor, settings, a proper first-launch flow, installers for all three OSes, and an end-to-end smoke test of the real app.

**Architecture:** The main process gains a few service methods (fire, role and skill saving, settings, project options, agent logs, per-agent messages) behind typed IPC. The renderer becomes a small view router (`office | tasks | team | settings | agent`) kept in the existing reducer. Presentational sprite components are ported from the design canvas, and their logic lives in pure, unit-tested helpers. electron-builder packages the app; Playwright drives the built app against the fake CLI.

**Tech Stack:** Plans 1–2 stack + `@fontsource/{pixelify-sans,ibm-plex-sans,ibm-plex-mono}` (OFL fonts bundled locally), `electron-builder` 26, `@playwright/test` 1.64 (`_electron`).

**Spec:** `docs/superpowers/specs/2026-10-14-agentoffice-design.md` (§8 UI, §9a packaging, §10 E2E smoke, §12 milestones 5–6)
**Design:** https://claude.ai/artifact/YZ2SXE3nzJBD7R3AuSyE9G. Use the screens Office, Agent detail, Task board, Team & role editor, First launch, and the components Desk, Avatar and Sidebar. Palette: night `#14151F`, panel `#181926`/`#1C1E2B`, line `#2C2F42`, text `#ECE8DF`, muted `#A3A6B8`, amber `#F5B942`, teal `#52D1BE`, blue `#7AA2FF`, green `#8BD47A`, red `#FF7A6B`. Fonts: Pixelify Sans (display), IBM Plex Sans (UI), IBM Plex Mono (logs).

## Global Constraints

- All earlier constraints still apply: cross-platform CI green, args arrays, `node:path`, commit trailer, renderer sandboxed, strict CSP (`font-src 'self'`, so fonts must be bundled, never loaded from Google).
- Every interactive element is a real `<button>`, `<a>`, `<input>`, `<select>` or `<textarea>` with an accessible name. Text contrast is at least 4.5:1. Animations stop under `prefers-reduced-motion`.
- Agent and model text is rendered only as React text. Never use `dangerouslySetInnerHTML`.
- The window is usable down to 960×640, which is the minimum window size.
- Any path the renderer asks the main process to open must resolve inside the project's `.agentoffice/wt/` folder.
- Test-only environment overrides (`AO_*`) are read only in `src/main/index.ts`. Each one is documented in the README "Develop" section.

## Review Focus

1. **Hostile or odd names and text** (very long agent names, role names, task titles, emoji, model output with markup) → layout never breaks out of desks or cards; nothing is interpreted as HTML. Test: Task 2 helpers (bubble clipping) + Task 11 E2E types such text.
2. **Settings edge cases** (max concurrent `0`, `99`, `"abc"`, a non-existent Claude path, a role id that collides or has `../`) → rejected with a clear message, never saved. Test: Task 1.
3. **Firing an agent that is busy or has open work** → refused with a reason; the worktree of a fired agent is removed and their branches are kept. Test: Task 1.
4. **App launched with no Claude Code installed, or on a fresh machine** → the first-launch screen explains what to do; the app never crashes. Test: Task 11 (E2E with the CLI hidden).
5. **Opening the worktree of an agent** → only paths inside `.agentoffice/wt/` are opened; anything else is refused. Test: Task 1.

---

## File Structure

```
src/shared/types.ts                     + AppSettings, ProjectPatch, OpenOptions, LogEntry; WorkspaceEvent 'project'; agent-event carries `at`
src/shared/ipc.ts                       + new channels and API methods
src/main/agents/agentManager.ts         + fire()
src/main/store/settingsStore.ts         app-wide settings (claude path, settings isolation)
src/main/store/validate.ts              zod schemas: role, skill, project patch, settings
src/main/workspace/projectService.ts    + open options, updateProject, saveRole, listSkills, saveSkill, fire, messageAgent, agentLog, worktreeFor
src/main/index.ts                       + new IPC handlers, AO_* test overrides, shell.openPath guard
src/renderer/src/main.tsx               font + stylesheet imports
src/renderer/src/styles/{tokens,app,office}.css   replaces styles.css + workspace.css
src/renderer/src/state.ts               + view routing, roles, LogEntry logs
src/renderer/src/sprites/{sprite.ts,DeskSprite.tsx,Avatar.tsx}
src/renderer/src/office/model.ts        pure helpers: displayState, whiteboard, statusCounts, progress, splitTeam
src/renderer/src/team/roleForm.ts       pure helpers for the role editor
src/renderer/src/components/
  Sidebar.tsx, Header.tsx, OfficeView.tsx, AgentDetailView.tsx, TaskBoard.tsx,
  TeamView.tsx, RoleEditor.tsx, SettingsView.tsx, Onboarding.tsx, BossChat.tsx (restyled)
  (Workspace.tsx and TeamPanel.tsx are deleted)
scripts/make-icon.mjs                   writes build/icon.png from a pixel grid (no image tools needed)
electron-builder.yml, .github/workflows/release.yml
playwright.config.ts, e2e/smoke.spec.ts
```

---

### Task 1: Main-process features: fire, roles and skills, settings, project options, logs, worktree guard

**Files:**
- Modify: `src/shared/types.ts`, `src/main/agents/agentManager.ts`, `src/main/workspace/projectService.ts`, `src/main/store/paths.ts` (nothing new, settingsFile exists)
- Create: `src/main/store/settingsStore.ts`, `src/main/store/validate.ts`
- Test: `test/fire.test.ts`, `test/projectService.ui.test.ts`, `src/main/store/validate.test.ts`, `src/main/store/settingsStore.test.ts`

**Interfaces:**
- Produces:
```ts
// shared/types.ts
export interface AppSettings { claudePath: string | null; isolateUserSettings: boolean }
export interface ProjectPatch { maxConcurrent?: number; autoMerge?: boolean; bossCanHire?: boolean }
export interface OpenOptions { bossName?: string; bossModel?: string; bossCanHire?: boolean }
export interface LogEntry { at: string; event: RunnerEvent }
// WorkspaceEvent changes:
//   | { type: 'agent-event'; agentId: string; event: RunnerEvent; at: string }   (adds `at`)
//   | { type: 'project'; project: Project }                                     (new)
// AgentManager
fire(agentId: string): Promise<void>;
// validate.ts
export const roleSchema, skillSchema, projectPatchSchema, settingsSchema (zod); export function parseOrThrow<T>(schema, value, what): T
// settingsStore.ts
export const DEFAULT_SETTINGS: AppSettings;
export class SettingsStore(file) { get(): Promise<AppSettings>; save(patch: Partial<AppSettings>): Promise<AppSettings> }
// ProjectService
open(repoPath: string, opts?: OpenOptions): Promise<WorkspaceSnapshot>;
updateProject(patch: unknown): Promise<Project>;
saveRole(role: unknown): Promise<Role>;
listSkills(): Promise<Skill[]>;
saveSkill(skill: unknown): Promise<Skill>;
fire(agentId: string): Promise<void>;
messageAgent(ref: string, text: string): Promise<MessageResult>;
agentLog(agentId: string, limit?: number): Promise<LogEntry[]>;
worktreeFor(agentId: string): string;   // throws unless inside <repo>/.agentoffice/wt/
configure(o: { claudeBin?: string; isolateUserSettings?: boolean }): void;  // applies to projects opened afterwards
export function isInside(child: string, parent: string): boolean;
```

- [ ] **Step 1: Write the failing tests**

`src/main/store/validate.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseOrThrow, projectPatchSchema, roleSchema, settingsSchema, skillSchema } from './validate';

const role = { id: 'frontend', name: 'Frontend Engineer', blurb: 'UI', systemPrompt: 'Be good.', skills: ['react-patterns'], model: 'sonnet', permissionMode: 'acceptEdits', allowedTools: ['Read'], look: { hair: '#E2583E', shirt: '#2F9E8F', skin: '#F1C9A5' } };

describe('validation', () => {
  it('accepts a valid role and rejects unsafe or broken ones', () => {
    expect(parseOrThrow(roleSchema, role, 'role')).toEqual(role);
    expect(() => parseOrThrow(roleSchema, { ...role, id: '../x' }, 'role')).toThrow(/Invalid role: id/);
    expect(() => parseOrThrow(roleSchema, { ...role, name: '' }, 'role')).toThrow(/Invalid role: name/);
    expect(() => parseOrThrow(roleSchema, { ...role, look: { ...role.look, shirt: 'red' } }, 'role')).toThrow(/look\.shirt/);
    expect(() => parseOrThrow(roleSchema, { ...role, permissionMode: 'yolo' }, 'role')).toThrow(/permissionMode/);
    expect(() => parseOrThrow(roleSchema, { ...role, allowedTools: [] }, 'role')).toThrow(/allowedTools/);
  });

  it('checks project settings ranges', () => {
    expect(parseOrThrow(projectPatchSchema, { maxConcurrent: 3, autoMerge: true }, 'settings')).toEqual({ maxConcurrent: 3, autoMerge: true });
    for (const bad of [0, 9, 2.5, 'abc']) expect(() => parseOrThrow(projectPatchSchema, { maxConcurrent: bad }, 'settings')).toThrow(/maxConcurrent/);
    expect(() => parseOrThrow(projectPatchSchema, { repoPath: '/etc' }, 'settings')).toThrow();
  });

  it('checks skills and app settings', () => {
    expect(parseOrThrow(skillSchema, { id: 'my-skill', name: 'Mine', description: '', body: 'Do x.' }, 'skill').id).toBe('my-skill');
    expect(() => parseOrThrow(skillSchema, { id: 'Bad Id', name: 'x', description: '', body: 'b' }, 'skill')).toThrow(/id/);
    expect(parseOrThrow(settingsSchema, { claudePath: null }, 'settings')).toEqual({ claudePath: null });
    expect(() => parseOrThrow(settingsSchema, { isolateUserSettings: 'yes' }, 'settings')).toThrow();
  });
});
```

`src/main/store/settingsStore.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_SETTINGS, SettingsStore } from './settingsStore';

let dir: string;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-set-')); });
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); });

describe('SettingsStore', () => {
  it('returns defaults, then merges and persists patches', async () => {
    const s = new SettingsStore(path.join(dir, 'settings.json'));
    expect(await s.get()).toEqual(DEFAULT_SETTINGS);
    expect(await s.save({ claudePath: '/opt/claude' })).toEqual({ ...DEFAULT_SETTINGS, claudePath: '/opt/claude' });
    expect(await new SettingsStore(path.join(dir, 'settings.json')).get()).toMatchObject({ claudePath: '/opt/claude', isolateUserSettings: true });
  });

  it('rejects invalid patches', async () => {
    const s = new SettingsStore(path.join(dir, 'settings.json'));
    await expect(s.save({ isolateUserSettings: 'no' } as never)).rejects.toThrow();
  });
});
```

`test/fire.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { git } from '../src/main/git/worktrees';
import { finished, harness, waitFor, type Harness } from './helpers/manager';

let h: Harness;
beforeEach(async () => { h = await harness(); });
afterEach(async () => { await h.cleanup(); });

describe('AgentManager.fire', () => {
  it('fires an idle agent, removes their worktree and keeps their branch', async () => {
    const { manager } = await h.make();
    const pixel = await manager.hire('frontend');
    const exited = waitFor(manager, (e) => e.type === 'agent-event' && e.event.type === 'exit');
    const done = finished(manager, 'T-101');
    await manager.createTask({ assignee: 'Pixel', title: 'a', brief: 'a', createdBy: 'user' });
    await done;
    await exited;
    await manager.idle();
    expect(await manager.merge('T-101')).toMatchObject({ status: 'merged' });
    const wt = manager.findAgent(pixel.id)!.worktreePath!;
    await manager.fire(pixel.id);
    expect(manager.findAgent(pixel.id)).toBeUndefined();
    expect(existsSync(wt)).toBe(false);
    expect(await git(h.repo, ['branch', '--list', 'ao/pixel/*'])).toContain('ao/pixel/a-t-101');
    expect((await manager.hire('frontend')).name).toBe('Pixel');
  });

  it('refuses to fire someone with queued, running or unreviewed work', async () => {
    const { manager } = await h.make();
    const pixel = await manager.hire('frontend');
    h.fakeEnv.FAKE_CLAUDE_HANG = '1';
    const started = waitFor(manager, (e) => e.type === 'agent-event' && e.event.type === 'init');
    await manager.createTask({ assignee: 'Pixel', title: 'a', brief: 'a', createdBy: 'user' });
    await started;
    await expect(manager.fire(pixel.id)).rejects.toThrow(/Pixel still has open work: T-101/);
  });

  it('refuses to fire the boss', async () => {
    const { manager } = await h.make();
    const boss = await manager.createBoss('Max');
    await expect(manager.fire(boss.id)).rejects.toThrow(/boss cannot be fired/);
  });
});
```

`test/projectService.ui.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectService, isInside } from '../src/main/workspace/projectService';
import { dataPaths } from '../src/main/store/paths';
import type { WorkspaceEvent } from '../src/shared/types';
import { makeRepo } from './helpers/repo';
import { FAKE_CLAUDE } from './helpers/runner';

let repo: string;
let data: string;
let svc: ProjectService;
let events: WorkspaceEvent[];
const fakeEnv: Record<string, string> = { FAKE_CLAUDE_FILE: 'notes.txt' };

beforeEach(async () => {
  repo = await makeRepo();
  data = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-svcui-'));
  svc = new ProjectService({ paths: dataPaths(data), resourcesDir: path.resolve('resources'), claudeBin: process.execPath, claudeBinArgs: [FAKE_CLAUDE], claudeEnv: fakeEnv as NodeJS.ProcessEnv });
  await svc.init();
  events = [];
  svc.on('event', (e) => events.push(e));
});
afterEach(async () => {
  await svc.close();
  await fs.rm(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  await fs.rm(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const until = (pred: (e: WorkspaceEvent) => boolean, ms = 20000) => new Promise<WorkspaceEvent>((resolve, reject) => {
  const hit = events.find(pred);
  if (hit) return resolve(hit);
  const timer = setTimeout(() => reject(new Error('timed out')), ms);
  svc.on('event', function l(e: WorkspaceEvent) { if (pred(e)) { clearTimeout(timer); svc.off('event', l); resolve(e); } });
});

describe('ProjectService (UI features)', () => {
  it('applies open options to a new project and its boss', async () => {
    const snap = await svc.open(repo, { bossName: 'Ada', bossModel: 'sonnet', bossCanHire: false });
    expect(snap.agents.find((a) => a.kind === 'boss')!.name).toBe('Ada');
    expect(snap.project.bossCanHire).toBe(false);
    expect((await svc.listRoles()).find((r) => r.id === 'boss')!.model).toBe('sonnet');
  });

  it('updates project settings with validation and emits the change', async () => {
    await svc.open(repo);
    expect(await svc.updateProject({ maxConcurrent: 2, autoMerge: true })).toMatchObject({ maxConcurrent: 2, autoMerge: true });
    expect(events.some((e) => e.type === 'project' && e.project.maxConcurrent === 2)).toBe(true);
    await expect(svc.updateProject({ maxConcurrent: 99 })).rejects.toThrow(/maxConcurrent/);
    expect((await svc.snapshot()).project.maxConcurrent).toBe(2);
  });

  it('saves roles and skills after validating them', async () => {
    await svc.open(repo);
    const fe = (await svc.listRoles()).find((r) => r.id === 'frontend')!;
    await svc.saveRole({ ...fe, model: 'opus' });
    expect((await svc.listRoles()).find((r) => r.id === 'frontend')!.model).toBe('opus');
    await expect(svc.saveRole({ ...fe, id: '../evil' })).rejects.toThrow(/Invalid role/);
    const skill = await svc.saveSkill({ id: 'house-style', name: 'House style', description: 'How we write code', body: '- Use tabs.' });
    expect(skill.id).toBe('house-style');
    expect((await svc.listSkills()).map((s) => s.id)).toContain('house-style');
  });

  it('streams agent events with timestamps, serves their log, and guards worktree paths', async () => {
    await svc.open(repo);
    const pixel = await svc.hire('frontend');
    await svc.tools().find((t) => t.name === 'assign_task')!.run({ agent: 'Pixel', title: 'Notes', brief: 'write notes' });
    const ev = await until((e) => e.type === 'agent-event');
    expect(ev).toMatchObject({ agentId: pixel.id, at: expect.stringMatching(/^\d{4}-/) });
    await until((e) => e.type === 'tasks' && e.tasks.some((t) => t.status === 'review'));
    const log = await svc.agentLog(pixel.id);
    expect(log.map((l) => l.event.type)).toContain('result');
    expect(svc.worktreeFor(pixel.id)).toBe(path.join(repo, '.agentoffice', 'wt', 'pixel'));
    const boss = (await svc.snapshot()).agents.find((a) => a.kind === 'boss')!;
    expect(() => svc.worktreeFor(boss.id)).toThrow(/no worktree/);
  });

  it('isInside only accepts real children', () => {
    expect(isInside(path.join('/a', 'b', 'c'), path.join('/a', 'b'))).toBe(true);
    expect(isInside(path.join('/a', 'b'), path.join('/a', 'b'))).toBe(false);
    expect(isInside(path.join('/a', 'bc'), path.join('/a', 'b'))).toBe(false);
    expect(isInside(path.join('/a', 'b', '..', 'x'), path.join('/a', 'b'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/main/store/validate.test.ts src/main/store/settingsStore.test.ts test/fire.test.ts test/projectService.ui.test.ts`
Expected: FAIL — modules or methods missing.

- [ ] **Step 3: Add the shared types** (`src/shared/types.ts`)

```ts
export interface AppSettings { claudePath: string | null; isolateUserSettings: boolean }
export interface ProjectPatch { maxConcurrent?: number; autoMerge?: boolean; bossCanHire?: boolean }
export interface OpenOptions { bossName?: string; bossModel?: string; bossCanHire?: boolean }
export interface LogEntry { at: string; event: RunnerEvent }
```
Change the `agent-event` member of `WorkspaceEvent` to `{ type: 'agent-event'; agentId: string; event: RunnerEvent; at: string }` and add `| { type: 'project'; project: Project }`.

- [ ] **Step 4: Write `src/main/store/validate.ts`**

```ts
import { z } from 'zod';

const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'must be a #RRGGBB colour');
const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'use lowercase letters, digits and dashes');

export const roleSchema = z.object({
  id,
  name: z.string().trim().min(1).max(60),
  blurb: z.string().max(120),
  systemPrompt: z.string().max(20_000),
  skills: z.array(id).max(50),
  model: z.string().trim().min(1).max(80),
  permissionMode: z.enum(['acceptEdits', 'default', 'plan', 'bypassPermissions']),
  allowedTools: z.array(z.string().trim().min(1).max(200)).min(1).max(100),
  look: z.object({ hair: hex, shirt: hex, skin: hex }),
}).strict();

export const skillSchema = z.object({
  id,
  name: z.string().trim().min(1).max(80),
  description: z.string().max(200),
  body: z.string().min(1).max(50_000),
}).strict();

export const projectPatchSchema = z.object({
  maxConcurrent: z.number().int().min(1).max(8).optional(),
  autoMerge: z.boolean().optional(),
  bossCanHire: z.boolean().optional(),
}).strict();

export const settingsSchema = z.object({
  claudePath: z.string().trim().min(1).max(1000).nullable().optional(),
  isolateUserSettings: z.boolean().optional(),
}).strict();

export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  const first = r.error.issues[0];
  const where = first?.path.length ? first.path.join('.') : 'value';
  throw new Error(`Invalid ${what}: ${where} ${first?.message ?? 'is not valid'}`);
}
```

- [ ] **Step 5: Write `src/main/store/settingsStore.ts`**

```ts
import type { AppSettings } from '../../shared/types';
import { readJson, writeJsonAtomic } from './jsonStore';
import { parseOrThrow, settingsSchema } from './validate';

export const DEFAULT_SETTINGS: AppSettings = { claudePath: null, isolateUserSettings: true };

export class SettingsStore {
  constructor(private readonly file: string) {}

  async get(): Promise<AppSettings> {
    return { ...DEFAULT_SETTINGS, ...(await readJson<Partial<AppSettings>>(this.file, {})) };
  }

  async save(patch: Partial<AppSettings>): Promise<AppSettings> {
    const clean = parseOrThrow(settingsSchema, patch, 'settings');
    const next: AppSettings = { ...(await this.get()), ...clean } as AppSettings;
    await writeJsonAtomic(this.file, next);
    return next;
  }
}
```

- [ ] **Step 6: Add `fire` to `AgentManager`**

```ts
  fire(agentId: string): Promise<void> {
    return this.run(async () => {
      this.assertOpen();
      const agent = this.mustAgent(agentId);
      if (agent.kind === 'boss') throw new Error('The boss cannot be fired');
      const open = this.taskList.filter((t) => t.assigneeId === agent.id && ['queued', 'working', 'needs_help', 'review'].includes(t.status));
      if (open.length > 0) throw new Error(`${agent.name} still has open work: ${open.map((t) => t.id).join(', ')}. Merge or cancel it first.`);
      if (this.live.has(agent.id)) throw new Error(`${agent.name} is working right now. Wait for them to finish first.`);
      await this.d.worktrees.remove(agent.name);
      this.agentList = this.agentList.filter((a) => a.id !== agent.id);
      await this.saveAgents();
    });
  }
```

The open-work check comes first so the refusal always names the tasks that block the firing.

- [ ] **Step 7: Extend `ProjectService`**

Imports: add `AppSettings`-free types `LogEntry, OpenOptions, Project, ProjectPatch, Skill` and `MessageResult` from agentManager; `parseOrThrow, projectPatchSchema, roleSchema, skillSchema` from `../store/validate`; `promises as fs` from `node:fs`.

Add the exported helper:
```ts
export function isInside(child: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}
```

Make the CLI path and settings isolation swappable: add `private claudeBin: string;` and `private isolate: boolean;` set from `d.claudeBin` / `d.isolateUserSettings ?? true` in the constructor, use them wherever `this.d.claudeBin` / the isolate flag were used, and add:
```ts
  configure(o: { claudeBin?: string; isolateUserSettings?: boolean }): void {
    if (o.claudeBin) this.claudeBin = o.claudeBin;
    if (o.isolateUserSettings !== undefined) this.isolate = o.isolateUserSettings;
  }
```

Change `open(repoPath: string, bossName = 'Max')` to `open(repoPath: string, opts: OpenOptions = {})`. In the new-project default use `bossCanHire: opts.bossCanHire ?? true`. Before `manager.createBoss(...)`:
```ts
    if (opts.bossModel) {
      const bossRole = await this.roles.get('boss');
      if (bossRole) await this.roles.save({ ...bossRole, model: opts.bossModel });
    }
    const bossAgent = await manager.createBoss(opts.bossName?.trim() || 'Max');
```

In `forward`, add `at` to agent events:
```ts
      case 'agent-event': return this.emitWs(ws, { type: 'agent-event', agentId: e.agentId, event: e.event, at: new Date().toISOString() });
```

New methods:
```ts
  async updateProject(patch: unknown): Promise<Project> {
    const ws = this.mustWs();
    const clean: ProjectPatch = parseOrThrow(projectPatchSchema, patch, 'project settings');
    Object.assign(ws.project, clean);
    await this.store.saveProject(ws.project);
    this.emitWs(ws, { type: 'project', project: { ...ws.project } });
    return { ...ws.project };
  }

  async saveRole(role: unknown): Promise<Role> {
    const clean = parseOrThrow(roleSchema, role, 'role');
    await this.roles.save(clean);
    return clean;
  }

  listSkills(): Promise<Skill[]> { return this.skills.list(); }

  async saveSkill(skill: unknown): Promise<Skill> {
    const clean = parseOrThrow(skillSchema, skill, 'skill');
    await this.skills.save(clean);
    return clean;
  }

  fire(agentId: string): Promise<void> { return this.mustWs().manager.fire(agentId); }
  messageAgent(ref: string, text: string): Promise<MessageResult> { return this.mustWs().manager.messageAgent(ref, text); }

  async agentLog(agentId: string, limit = 300): Promise<LogEntry[]> {
    const ws = this.mustWs();
    const raw = (await this.store.readLog(ws.project.id, agentId, limit)) as { at?: string; event?: LogEntry['event'] }[];
    return raw.filter((r): r is LogEntry => typeof r.at === 'string' && typeof r.event === 'object' && r.event !== null);
  }

  worktreeFor(agentId: string): string {
    const ws = this.mustWs();
    const agent = ws.manager.findAgent(agentId);
    const wt = agent?.worktreePath;
    const root = path.join(ws.project.repoPath, '.agentoffice', 'wt');
    if (!agent || !wt) throw new Error(`${agent?.name ?? 'That agent'} has no worktree yet`);
    if (!isInside(wt, root)) throw new Error('Refusing to open a folder outside the project worktrees');
    return wt;
  }
```

Add `save` to `SkillStore` (`src/main/store/skillStore.ts`):
```ts
  async save(skill: Skill): Promise<void> {
    if (!ID.test(skill.id)) throw new Error(`Invalid skill id: ${skill.id}`);
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(path.join(this.dir, `${skill.id}.md`), `---\nname: ${skill.name.replace(/\n/g, ' ')}\ndescription: ${skill.description.replace(/\n/g, ' ')}\n---\n${skill.body.trim()}\n`);
  }
```

- [ ] **Step 8: Run tests**

Run: `npx vitest run src/main/store test/fire.test.ts test/projectService.ui.test.ts test/projectService.test.ts && npm run typecheck`
Expected: PASS. Typecheck will flag the renderer reducer, because `agent-event` now has `at`. Fix that in Task 3. If it blocks typecheck now, have `applyEvent` ignore `at` for the moment; that is acceptable until Task 3.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(main): fire agents, role/skill saving, settings, project options, agent logs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Fonts, design tokens, sprites and pure office helpers

**Files:**
- Create: `src/renderer/src/styles/tokens.css`, `src/renderer/src/styles/office.css`, `src/renderer/src/sprites/sprite.ts`, `src/renderer/src/sprites/DeskSprite.tsx`, `src/renderer/src/sprites/Avatar.tsx`, `src/renderer/src/office/model.ts`
- Modify: `src/renderer/src/main.tsx`
- Test: `src/renderer/src/sprites/sprite.test.ts`, `src/renderer/src/office/model.test.ts`

**Interfaces:**
- Produces:
```ts
// sprite.ts
export interface ScreenColors { screen: string; ink: string; dot: string }
export const STATUS_COLORS: Record<AgentStatus, ScreenColors>;
export const STATUS_LABEL: Record<AgentStatus, string>;
export const FALLBACK_LOOK: Look;
export function lookFor(agent: Pick<Agent, 'roleId'>, roles: Role[]): Look;
export function spriteClass(status: AgentStatus): string;
export function clip(text: string, max: number): string;
// office/model.ts
export interface DisplayState { status: AgentStatus; bubble: string }
export function displayState(agent: Agent, tasks: Task[]): DisplayState;
export interface BoardLine { mark: '[x]' | '[>]' | '[?]' | '[!]' | '[ ]'; text: string; tone: 'done' | 'active' | 'review' | 'problem' | 'todo' }
export function whiteboard(tasks: Task[], agents: Agent[], limit?: number): BoardLine[];
export function statusCounts(agents: DisplayState[]): { working: number; thinking: number; waiting: number; problem: number };
export function progress(tasks: Task[]): { done: number; total: number };
export function splitTeam(agents: Agent[]): { boss: Agent | undefined; employees: Agent[] };
// DeskSprite.tsx
export function DeskSprite(p: { name: string; role: string; look: Look; status: AgentStatus; bubble: string; onClick?: () => void; selected?: boolean }): JSX.Element;
// Avatar.tsx
export function Avatar(p: { look: Look; size?: number; label?: string }): JSX.Element;
```

- [ ] **Step 1: Install fonts**

Run: `npm install @fontsource/pixelify-sans @fontsource/ibm-plex-sans @fontsource/ibm-plex-mono`

- [ ] **Step 2: Write the failing tests**

`src/renderer/src/sprites/sprite.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { FALLBACK_LOOK, STATUS_COLORS, STATUS_LABEL, clip, lookFor, spriteClass } from './sprite';
import type { AgentStatus, Role } from '../../../shared/types';

const statuses: AgentStatus[] = ['idle', 'thinking', 'working', 'waiting', 'done', 'error', 'paused'];

describe('sprite helpers', () => {
  it('has colours and a label for every status', () => {
    for (const s of statuses) {
      expect(STATUS_COLORS[s].dot).toMatch(/^#[0-9A-F]{6}$/i);
      expect(STATUS_LABEL[s].length).toBeGreaterThan(0);
      expect(spriteClass(s)).toBe(`sprite is-${s}`);
    }
  });

  it('uses the role look, or a neutral fallback', () => {
    const roles = [{ id: 'qa', look: { hair: '#111111', shirt: '#222222', skin: '#333333' } }] as Role[];
    expect(lookFor({ roleId: 'qa' }, roles)).toEqual({ hair: '#111111', shirt: '#222222', skin: '#333333' });
    expect(lookFor({ roleId: 'gone' }, roles)).toEqual(FALLBACK_LOOK);
  });

  it('clips long text with an ellipsis', () => {
    expect(clip('short', 10)).toBe('short');
    expect(clip('a'.repeat(50), 10)).toBe(`${'a'.repeat(9)}…`);
  });
});
```

`src/renderer/src/office/model.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { displayState, progress, splitTeam, statusCounts, whiteboard } from './model';
import type { Agent, Task } from '../../../shared/types';

const agent = (over: Partial<Agent>): Agent => ({ id: 'a1', projectId: 'p', name: 'Pixel', roleId: 'frontend', kind: 'employee', status: 'idle', bubble: 'Idle', ...over });
const task = (over: Partial<Task>): Task => ({ id: 'T-101', projectId: 'p', title: 'Toggle', brief: '', assigneeId: 'a1', createdBy: 'boss', status: 'queued', held: false, attempts: 0, branch: 'b', dependsOn: [], createdAt: '2026-10-14T10:00:00Z', updatedAt: '2026-10-14T10:00:00Z', ...over });

describe('displayState', () => {
  it('shows an idle agent with queued work as waiting', () => {
    expect(displayState(agent({}), [task({})])).toEqual({ status: 'waiting', bubble: 'Queued: Toggle' });
    expect(displayState(agent({}), [task({ dependsOn: ['T-100'] })])).toEqual({ status: 'waiting', bubble: 'Waiting on T-100' });
    expect(displayState(agent({}), [task({ held: true })])).toEqual({ status: 'paused', bubble: 'Paused: Toggle' });
  });

  it('passes live states through', () => {
    expect(displayState(agent({ status: 'working', bubble: 'Editing a.ts' }), [])).toEqual({ status: 'working', bubble: 'Editing a.ts' });
    expect(displayState(agent({}), [])).toEqual({ status: 'idle', bubble: 'Idle' });
  });
});

describe('whiteboard', () => {
  it('lists active work first with marks and owners, hiding cancelled tasks', () => {
    const agents = [agent({})];
    const lines = whiteboard([
      task({ id: 'T-1', title: 'Done thing', status: 'done' }),
      task({ id: 'T-2', title: 'Doing thing', status: 'working' }),
      task({ id: 'T-3', title: 'Broken thing', status: 'needs_help' }),
      task({ id: 'T-4', title: 'Gone', status: 'cancelled' }),
      task({ id: 'T-5', title: 'Check me', status: 'review' }),
    ], agents);
    expect(lines.map((l) => l.mark)).toEqual(['[>]', '[!]', '[?]', '[x]']);
    expect(lines[0]).toEqual({ mark: '[>]', text: 'Doing thing (Pixel)', tone: 'active' });
  });

  it('respects the limit', () => {
    const many = Array.from({ length: 10 }, (_, i) => task({ id: `T-${i}`, title: `t${i}` }));
    expect(whiteboard(many, [agent({})], 4)).toHaveLength(4);
  });
});

describe('counts', () => {
  it('counts live states and progress', () => {
    expect(statusCounts([{ status: 'working', bubble: '' }, { status: 'error', bubble: '' }, { status: 'paused', bubble: '' }, { status: 'waiting', bubble: '' }])).toEqual({ working: 1, thinking: 0, waiting: 2, problem: 1 });
    expect(progress([task({ status: 'done' }), task({ status: 'working' }), task({ status: 'cancelled' })])).toEqual({ done: 1, total: 2 });
  });

  it('splits the boss from employees', () => {
    const boss = agent({ id: 'b', kind: 'boss', name: 'Max' });
    expect(splitTeam([agent({}), boss])).toEqual({ boss, employees: [agent({})] });
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run src/renderer/src/sprites src/renderer/src/office`
Expected: FAIL — modules missing.

- [ ] **Step 4: Write `src/renderer/src/sprites/sprite.ts`**

```ts
import type { Agent, AgentStatus, Look, Role } from '../../../shared/types';

export interface ScreenColors { screen: string; ink: string; dot: string }

export const STATUS_COLORS: Record<AgentStatus, ScreenColors> = {
  working: { screen: '#123B37', ink: '#52D1BE', dot: '#52D1BE' },
  thinking: { screen: '#3A3018', ink: '#F5B942', dot: '#F5B942' },
  waiting: { screen: '#1C2440', ink: '#7AA2FF', dot: '#7AA2FF' },
  done: { screen: '#1B3320', ink: '#8BD47A', dot: '#8BD47A' },
  error: { screen: '#3D1C1C', ink: '#FF7A6B', dot: '#FF7A6B' },
  idle: { screen: '#1A1C28', ink: '#4A4F66', dot: '#6E7288' },
  paused: { screen: '#1A1C28', ink: '#A3A6B8', dot: '#A3A6B8' },
};

export const STATUS_LABEL: Record<AgentStatus, string> = {
  working: 'Working', thinking: 'Thinking', waiting: 'Waiting', done: 'Done', error: 'Needs help', idle: 'Idle', paused: 'Paused',
};

export const FALLBACK_LOOK: Look = { hair: '#A3A6B8', shirt: '#33374A', skin: '#E8B48A' };

export function lookFor(agent: Pick<Agent, 'roleId'>, roles: Role[]): Look {
  return roles.find((r) => r.id === agent.roleId)?.look ?? FALLBACK_LOOK;
}

export function spriteClass(status: AgentStatus): string {
  return `sprite is-${status}`;
}

export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
```

- [ ] **Step 5: Write `src/renderer/src/office/model.ts`**

```ts
import type { Agent, AgentStatus, Task } from '../../../shared/types';

export interface DisplayState { status: AgentStatus; bubble: string }

/** Live status, plus "waiting"/"paused" derived from the agent's queued work when they are idle. */
export function displayState(agent: Agent, tasks: Task[]): DisplayState {
  if (agent.status !== 'idle') return { status: agent.status, bubble: agent.bubble };
  const queued = tasks.find((t) => t.assigneeId === agent.id && t.status === 'queued');
  if (!queued) return { status: 'idle', bubble: agent.bubble || 'Idle' };
  if (queued.held) return { status: 'paused', bubble: `Paused: ${queued.title}` };
  if (queued.dependsOn.length > 0) return { status: 'waiting', bubble: `Waiting on ${queued.dependsOn.join(', ')}` };
  return { status: 'waiting', bubble: `Queued: ${queued.title}` };
}

export interface BoardLine { mark: '[x]' | '[>]' | '[?]' | '[!]' | '[ ]'; text: string; tone: 'done' | 'active' | 'review' | 'problem' | 'todo' }

const ORDER: Record<Task['status'], number> = { working: 0, needs_help: 1, failed: 1, review: 2, queued: 3, done: 4, cancelled: 5 };
const MARK: Record<Task['status'], Pick<BoardLine, 'mark' | 'tone'>> = {
  working: { mark: '[>]', tone: 'active' },
  needs_help: { mark: '[!]', tone: 'problem' },
  failed: { mark: '[!]', tone: 'problem' },
  review: { mark: '[?]', tone: 'review' },
  queued: { mark: '[ ]', tone: 'todo' },
  done: { mark: '[x]', tone: 'done' },
  cancelled: { mark: '[ ]', tone: 'todo' },
};

export function whiteboard(tasks: Task[], agents: Agent[], limit = 6): BoardLine[] {
  const who = (id: string) => agents.find((a) => a.id === id)?.name ?? '?';
  return tasks
    .filter((t) => t.status !== 'cancelled')
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit)
    .map((t) => ({ ...MARK[t.status], text: `${t.title} (${who(t.assigneeId)})` }));
}

export function statusCounts(states: DisplayState[]): { working: number; thinking: number; waiting: number; problem: number } {
  const c = { working: 0, thinking: 0, waiting: 0, problem: 0 };
  for (const s of states) {
    if (s.status === 'working') c.working++;
    else if (s.status === 'thinking') c.thinking++;
    else if (s.status === 'waiting' || s.status === 'paused') c.waiting++;
    else if (s.status === 'error') c.problem++;
  }
  return c;
}

export function progress(tasks: Task[]): { done: number; total: number } {
  const live = tasks.filter((t) => t.status !== 'cancelled');
  return { done: live.filter((t) => t.status === 'done').length, total: live.length };
}

export function splitTeam(agents: Agent[]): { boss: Agent | undefined; employees: Agent[] } {
  return { boss: agents.find((a) => a.kind === 'boss'), employees: agents.filter((a) => a.kind === 'employee') };
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/renderer/src/sprites src/renderer/src/office`
Expected: PASS.

- [ ] **Step 7: Write the sprite components** (ported from the design's `Desk.dc.html` and `Avatar.dc.html`)

`src/renderer/src/sprites/DeskSprite.tsx`:
```tsx
import type { AgentStatus, Look } from '../../../shared/types';
import { STATUS_COLORS, STATUS_LABEL, clip, spriteClass } from './sprite';

interface Props { name: string; role: string; look: Look; status: AgentStatus; bubble: string; onClick?: () => void; selected?: boolean }

export function DeskSprite({ name, role, look, status, bubble, onClick, selected }: Props) {
  const c = STATUS_COLORS[status];
  const body = (
    <>
      <span className="desk-bubble" title={bubble}>{clip(bubble, 34)}</span>
      <svg className={spriteClass(status)} viewBox="0 0 48 44" width="192" height="176" shapeRendering="crispEdges" aria-hidden="true">
        <rect x="4" y="40" width="40" height="3" fill="#000000" opacity="0.28" />
        <rect x="25" y="13" width="16" height="15" fill="#3A3F58" />
        <rect x="25" y="13" width="16" height="2" fill="#4A5070" />
        <g className="ao-body">
          <rect x="27" y="17" width="12" height="10" fill={look.shirt} />
          <rect x="31" y="17" width="4" height="2" fill={look.skin} />
          <g className="ao-head">
            <rect x="29" y="8" width="8" height="9" fill={look.skin} />
            <rect x="28" y="6" width="10" height="3" fill={look.hair} />
            <rect x="28" y="9" width="2" height="4" fill={look.hair} />
            <rect x="36" y="9" width="2" height="2" fill={look.hair} />
            <rect x="31" y="12" width="1" height="2" fill="#1B1B24" />
            <rect x="34" y="12" width="1" height="2" fill="#1B1B24" />
            <rect x="32" y="15" width="2" height="1" fill="#9A5A4A" />
          </g>
        </g>
        <g className="ao-armL">
          <rect x="25" y="19" width="3" height="7" fill={look.shirt} />
          <rect x="25" y="25" width="3" height="2" fill={look.skin} />
        </g>
        <g className="ao-armR">
          <rect x="38" y="19" width="3" height="7" fill={look.shirt} />
          <rect x="38" y="25" width="3" height="2" fill={look.skin} />
        </g>
        <rect x="4" y="9" width="18" height="14" fill="#2A2E40" />
        <rect className="ao-screen" x="5" y="10" width="16" height="11" fill={c.screen} />
        <g className="ao-code" fill={c.ink}>
          <rect x="6" y="11" width="7" height="1" />
          <rect x="6" y="13" width="11" height="1" />
          <rect x="8" y="15" width="8" height="1" />
          <rect x="8" y="17" width="5" height="1" />
          <rect x="6" y="19" width="9" height="1" />
        </g>
        <rect x="11" y="23" width="4" height="4" fill="#2A2E40" />
        <rect x="1" y="27" width="46" height="3" fill="#C9935C" />
        <rect x="1" y="27" width="46" height="1" fill="#DDA872" />
        <rect x="27" y="26" width="12" height="1" fill="#D8D2C4" />
        <rect x="42" y="23" width="3" height="4" fill="#ECE8DF" />
        <rect x="45" y="24" width="1" height="2" fill="#ECE8DF" />
        <rect x="3" y="30" width="42" height="10" fill="#8B5A34" />
        <rect x="3" y="30" width="42" height="1" fill="#6B4224" />
        <rect x="30" y="33" width="12" height="4" fill="#7A4D2B" />
        <rect x="35" y="35" width="2" height="1" fill="#C9935C" />
      </svg>
      <span className="desk-plate">
        <span className="dot" style={{ background: c.dot }} aria-hidden="true" />
        <span className="desk-name">{clip(name, 16)}</span>
        <span className="desk-role">{clip(role, 18)}</span>
      </span>
    </>
  );
  const label = `${name}, ${role}: ${STATUS_LABEL[status]}. ${bubble}`;
  return onClick ? (
    <button type="button" className={selected ? 'desk selected' : 'desk'} onClick={onClick} aria-label={label}>{body}</button>
  ) : (
    <div className="desk" role="img" aria-label={label}>{body}</div>
  );
}
```

`src/renderer/src/sprites/Avatar.tsx`:
```tsx
import type { Look } from '../../../shared/types';

export function Avatar({ look, size = 32, label }: { look: Look; size?: number; label?: string }) {
  return (
    <svg viewBox="0 0 12 12" width={size} height={size} shapeRendering="crispEdges" className="avatar" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <rect x="0" y="0" width="12" height="12" fill="#2A2D40" />
      <rect x="2" y="9" width="8" height="3" fill={look.shirt} />
      <rect x="3" y="2" width="6" height="7" fill={look.skin} />
      <rect x="3" y="1" width="6" height="2" fill={look.hair} />
      <rect x="2" y="2" width="1" height="3" fill={look.hair} />
      <rect x="9" y="2" width="1" height="2" fill={look.hair} />
      <rect x="4" y="5" width="1" height="1" fill="#1B1B24" />
      <rect x="7" y="5" width="1" height="1" fill="#1B1B24" />
    </svg>
  );
}
```

- [ ] **Step 8: Write the styles**

`src/renderer/src/styles/tokens.css`:
```css
:root {
  color-scheme: dark;
  --bg: #14151f; --panel: #181926; --panel-2: #1c1e2b; --card: #222436; --line: #2c2f42; --line-2: #3a3f58;
  --text: #ece8df; --muted: #a3a6b8; --faint: #6e7288;
  --amber: #f5b942; --amber-ink: #1a1408; --teal: #52d1be; --teal-ink: #0d2622; --blue: #7aa2ff; --green: #8bd47a; --red: #ff7a6b; --red-soft: #ff9a8e;
  --font-ui: 'IBM Plex Sans', system-ui, sans-serif; --font-pixel: 'Pixelify Sans', 'IBM Plex Sans', sans-serif; --font-mono: 'IBM Plex Mono', ui-monospace, monospace;
}
* { box-sizing: border-box; }
html, body, #root { height: 100%; }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.45 var(--font-ui); }
button, input, select, textarea { font: inherit; color: var(--text); }
button { cursor: pointer; }
:focus-visible { outline: 2px solid var(--teal); outline-offset: 2px; }
.pixel { font-family: var(--font-pixel); }
.mono { font-family: var(--font-mono); }
.muted { color: var(--muted); }
.small { font-size: 12px; }
.pre { white-space: pre-wrap; overflow-wrap: anywhere; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.add { color: var(--green); } .del { color: var(--red-soft); }
.btn { min-height: 40px; padding: 0 16px; border-radius: 6px; border: 1px solid var(--line-2); background: #1f2130; display: inline-flex; align-items: center; gap: 8px; }
.btn:disabled { opacity: .6; cursor: default; }
.btn.primary { background: var(--amber); color: var(--amber-ink); border-color: transparent; font-weight: 600; box-shadow: 0 3px 0 #a97a1f; }
.btn.teal { background: var(--teal); color: var(--teal-ink); border-color: transparent; font-weight: 600; }
.btn.danger { background: transparent; color: var(--red-soft); border-color: #6b3a36; }
.btn.small { min-height: 32px; padding: 0 10px; font-size: 13px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field label, .field .label { font-size: 13px; color: var(--muted); }
.input, select.input, textarea.input { background: #11121b; border: 1px solid var(--line-2); border-radius: 6px; min-height: 40px; padding: 8px 12px; }
.chip { font-family: var(--font-mono); font-size: 12px; background: #1f2130; border: 1px solid var(--line-2); padding: 3px 8px; border-radius: 4px; }
.dot { width: 9px; height: 9px; display: inline-block; flex: none; }
.bad { color: var(--red-soft); }
.ok { color: var(--green); }
code { font-family: var(--font-mono); background: #1f2130; padding: 2px 6px; border-radius: 4px; }
```

`src/renderer/src/styles/office.css`:
```css
.floor { border: 3px solid #0e0f16; box-shadow: 0 0 0 3px var(--line); background: repeating-conic-gradient(#3a2e29 0 25%, #42352f 0 50%) 0 0 / 48px 48px; display: flex; flex-direction: column; }
.wall { height: 64px; background: #2a2d40; border-bottom: 6px solid #1e2030; display: flex; align-items: center; gap: 28px; padding: 0 28px; }
.wall .window { width: 84px; height: 36px; background: #5c7fb8; border: 4px solid #1e2030; box-shadow: inset 0 -10px 0 #4a6a9e; }
.wall .clock { margin-left: auto; font-family: var(--font-pixel); font-size: 18px; color: var(--amber); background: var(--bg); border: 3px solid #1e2030; padding: 4px 10px; }
.wall .plant { width: 26px; height: 40px; background: #3e8e5a; border-bottom: 10px solid #8b5a34; }
.corner-office { margin: 24px 24px 0; display: flex; flex-wrap: wrap; align-items: flex-end; gap: 20px; padding: 16px 20px 12px; background: rgba(122,162,255,.10); border: 3px solid #5b6386; }
.corner-office .tag { align-self: flex-start; font-family: var(--font-pixel); font-size: 12px; color: var(--bg); background: var(--amber); padding: 2px 8px; }
.whiteboard { flex: 1 1 240px; min-width: 0; background: #f2efe6; color: #22232e; border: 4px solid #9aa0b8; padding: 14px 16px; display: flex; flex-direction: column; gap: 6px; box-shadow: 4px 4px 0 rgba(0,0,0,.35); }
.whiteboard h3 { margin: 0 0 4px; font-family: var(--font-pixel); font-size: 16px; font-weight: 500; }
.whiteboard .line { display: flex; gap: 8px; font-size: 13px; overflow-wrap: anywhere; }
.whiteboard .mark { font-family: var(--font-mono); font-size: 12px; flex: none; }
.whiteboard .tone-done { color: #2f7a3e; } .whiteboard .tone-active { color: #1f7a70; } .whiteboard .tone-review { color: #8a5a00; } .whiteboard .tone-problem { color: #b23a48; } .whiteboard .tone-todo { color: #5a5e70; }
.desks { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px 20px; padding: 20px 24px 28px; justify-items: center; }
.desk { width: 220px; height: 252px; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 4px; background: none; border: 2px solid transparent; padding: 0; color: var(--text); }
button.desk:hover, .desk.selected { border-color: rgba(245,185,66,.6); background: rgba(20,21,31,.25); }
.desk-bubble { max-width: 200px; background: #f2efe6; color: #1b1c26; border: 3px solid var(--bg); padding: 3px 10px; font-family: var(--font-pixel); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; box-shadow: 3px 3px 0 rgba(0,0,0,.35); position: relative; }
.desk-bubble::after { content: ''; position: absolute; left: 50%; bottom: -10px; transform: translateX(-50%); border: 6px solid transparent; border-top: 7px solid var(--bg); }
.desk-plate { display: flex; align-items: center; gap: 8px; background: var(--bg); border: 2px solid var(--line); padding: 3px 10px 3px 8px; max-width: 216px; }
.desk-name { font-family: var(--font-pixel); font-size: 15px; white-space: nowrap; }
.desk-role { font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.empty-desk { width: 220px; height: 252px; border: 3px dashed #6b5a50; background: rgba(20,21,31,.35); color: #e7d3c2; font-family: var(--font-pixel); font-size: 16px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; }
@keyframes ao-tap { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-1px); } }
@keyframes ao-blink { 50% { opacity: .45; } }
@keyframes ao-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-1px); } }
.is-working .ao-armL { animation: ao-tap .3s steps(1) infinite; }
.is-working .ao-armR { animation: ao-tap .3s steps(1) infinite .15s; }
.is-working .ao-code { animation: ao-blink 1s steps(2) infinite; }
.is-thinking .ao-head { animation: ao-bob 1.4s steps(1) infinite; }
.is-waiting .ao-body { animation: ao-bob 2.6s steps(1) infinite; }
.is-error .ao-screen { animation: ao-blink .7s steps(1) infinite; }
.cursor-blink { animation: ao-blink 1s steps(1) infinite; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; } }
```

`src/renderer/src/main.tsx` — replace the two old stylesheet imports with:
```ts
import '@fontsource/pixelify-sans/500.css';
import '@fontsource/pixelify-sans/700.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles/tokens.css';
import './styles/app.css';
import './styles/office.css';
```
(`app.css` is created in Task 4; until then create it empty.)

- [ ] **Step 9: Typecheck and commit**

Run: `npm run typecheck && npx vitest run src/renderer`
Expected: PASS. If the `@fontsource` CSS imports fail typecheck, they are already covered by `declare module '*.css'` in `assets.d.ts`.

```bash
git add -A
git commit -m "feat(ui): bundled fonts, design tokens, desk/avatar sprites and office helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Renderer state, IPC surface and main-process wiring

**Files:**
- Modify: `src/renderer/src/state.ts`, `src/renderer/src/state.test.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/index.ts`, `src/renderer/src/components/TeamPanel.tsx` (one-line type fix; the file is deleted in Task 4)

**Interfaces:**
- Consumes: Task 1 service methods and types.
- Produces:
```ts
export type View = { name: 'office' } | { name: 'tasks' } | { name: 'team' } | { name: 'settings' } | { name: 'agent'; agentId: string };
export interface UiState { ws: WorkspaceSnapshot | null; logs: Record<string, LogEntry[]>; errors: string[]; view: View; roles: Role[] }
export type UiAction =
  | { type: 'snapshot'; ws: WorkspaceSnapshot } | { type: 'closed' } | { type: 'event'; event: WorkspaceEvent }
  | { type: 'error'; message: string } | { type: 'dismiss-error'; index: number } | { type: 'navigate'; view: View }
  | { type: 'roles'; roles: Role[] } | { type: 'logs-loaded'; agentId: string; entries: LogEntry[] };
// AgentOfficeApi additions
openProject(repoPath: string, opts?: OpenOptions): Promise<WorkspaceSnapshot>;
closeProject(): Promise<void>; updateProject(patch: ProjectPatch): Promise<Project>;
agentLog(agentId: string): Promise<LogEntry[]>; messageAgent(agentId: string, text: string): Promise<void>;
openWorktree(agentId: string): Promise<void>; fireAgent(agentId: string): Promise<void>;
saveRole(role: Role): Promise<Role>; listSkills(): Promise<Skill[]>; saveSkill(skill: Skill): Promise<Skill>;
getSettings(): Promise<AppSettings>; saveSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
```
- Test-only env overrides read in `src/main/index.ts`: `AO_USER_DATA` (userData dir), `AO_CLAUDE_BIN` + `AO_CLAUDE_ARGS` (JSON string array prepended to claude args), `AO_CLAUDE_MISSING=1` (pretend Claude is not installed), `AO_E2E_PICK_FOLDER` (folder returned by the picker).

- [ ] **Step 1: Write the failing tests** — replace `src/renderer/src/state.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { initialState, reducer, type UiState } from './state';
import type { Agent, WorkspaceSnapshot } from '../../shared/types';

const agent = (id: string, name: string): Agent => ({ id, projectId: 'p', name, roleId: 'frontend', kind: 'employee', status: 'idle', bubble: 'Idle' });
const ws: WorkspaceSnapshot = {
  project: { id: 'p', name: 'demo', repoPath: '/r', baseBranch: 'main', maxConcurrent: 4, bossCanHire: true, autoMerge: false },
  agents: [agent('a', 'Pixel')], tasks: [], chat: [], merges: [],
};
const opened: UiState = reducer(initialState, { type: 'snapshot', ws });
const text = (t: string) => ({ type: 'text' as const, text: t });

describe('ui reducer', () => {
  it('opens on the office view and can navigate', () => {
    expect(opened.view).toEqual({ name: 'office' });
    expect(reducer(opened, { type: 'navigate', view: { name: 'agent', agentId: 'a' } }).view).toEqual({ name: 'agent', agentId: 'a' });
  });

  it('leaves an agent page when that agent is fired', () => {
    const s = reducer(opened, { type: 'navigate', view: { name: 'agent', agentId: 'a' } });
    expect(reducer(s, { type: 'event', event: { type: 'agents', agents: [] } }).view).toEqual({ name: 'team' });
  });

  it('applies chat, merges, project changes and closing', () => {
    let s = reducer(opened, { type: 'event', event: { type: 'chat', entry: { kind: 'user', at: 't', text: 'hi' } } });
    s = reducer(s, { type: 'event', event: { type: 'merge-request', request: { requestId: 'r1', taskId: 'T-1', title: 't', agentName: 'Pixel', diffStat: [], summary: '' } } });
    s = reducer(s, { type: 'event', event: { type: 'project', project: { ...ws.project, autoMerge: true } } });
    expect(s.ws!.chat).toHaveLength(1);
    expect(s.ws!.merges).toHaveLength(1);
    expect(s.ws!.project.autoMerge).toBe(true);
    s = reducer(s, { type: 'event', event: { type: 'merge-resolved', requestId: 'r1' } });
    expect(s.ws!.merges).toEqual([]);
    expect(reducer(s, { type: 'closed' })).toMatchObject({ ws: null, view: { name: 'office' } });
  });

  it('keeps timestamped logs, capped, and merges loaded history without duplicates', () => {
    let s = opened;
    for (let i = 0; i < 350; i++) s = reducer(s, { type: 'event', event: { type: 'agent-event', agentId: 'a', event: text(String(i)), at: `2026-10-14T10:00:${String(i).padStart(3, '0')}Z` } });
    expect(s.logs.a).toHaveLength(300);
    let t = reducer(opened, { type: 'event', event: { type: 'agent-event', agentId: 'a', event: text('live'), at: '2026-10-14T10:00:05Z' } });
    t = reducer(t, { type: 'event', event: { type: 'agent-event', agentId: 'a', event: text('older'), at: '2026-10-14T10:00:01Z' } });
    t = reducer(t, { type: 'logs-loaded', agentId: 'a', entries: [{ at: '2026-10-14T10:00:01Z', event: text('older') }, { at: '2026-10-14T10:00:02Z', event: text('disk') }] });
    expect(t.logs.a.map((e) => (e.event as { text: string }).text)).toEqual(['older', 'disk', 'live']);
  });

  it('stores roles and keeps the last five errors', () => {
    expect(reducer(opened, { type: 'roles', roles: [] }).roles).toEqual([]);
    let s = opened;
    for (let i = 0; i < 7; i++) s = reducer(s, { type: 'error', message: `e${i}` });
    expect(s.errors).toEqual(['e2', 'e3', 'e4', 'e5', 'e6']);
    expect(reducer(s, { type: 'dismiss-error', index: 0 }).errors[0]).toBe('e3');
  });

  it('ignores workspace events before a project is open', () => {
    expect(reducer(initialState, { type: 'event', event: { type: 'tasks', tasks: [] } })).toBe(initialState);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/renderer/src/state.test.ts`
Expected: FAIL — no `view`, `navigate`, `logs-loaded`, etc.

- [ ] **Step 3: Rewrite `src/renderer/src/state.ts`**

```ts
import type { LogEntry, Role, WorkspaceEvent, WorkspaceSnapshot } from '../../shared/types';

export type View = { name: 'office' } | { name: 'tasks' } | { name: 'team' } | { name: 'settings' } | { name: 'agent'; agentId: string };

export interface UiState {
  ws: WorkspaceSnapshot | null;
  logs: Record<string, LogEntry[]>;
  errors: string[];
  view: View;
  roles: Role[];
}

export type UiAction =
  | { type: 'snapshot'; ws: WorkspaceSnapshot }
  | { type: 'closed' }
  | { type: 'event'; event: WorkspaceEvent }
  | { type: 'error'; message: string }
  | { type: 'dismiss-error'; index: number }
  | { type: 'navigate'; view: View }
  | { type: 'roles'; roles: Role[] }
  | { type: 'logs-loaded'; agentId: string; entries: LogEntry[] };

export const initialState: UiState = { ws: null, logs: {}, errors: [], view: { name: 'office' }, roles: [] };
const LOG_CAP = 300;

export function reducer(s: UiState, a: UiAction): UiState {
  switch (a.type) {
    case 'snapshot': return { ...s, ws: a.ws, logs: {}, view: { name: 'office' } };
    case 'closed': return { ...s, ws: null, logs: {}, view: { name: 'office' } };
    case 'error': return { ...s, errors: [...s.errors, a.message].slice(-5) };
    case 'dismiss-error': return { ...s, errors: s.errors.filter((_, i) => i !== a.index) };
    case 'navigate': return { ...s, view: a.view };
    case 'roles': return { ...s, roles: a.roles };
    case 'logs-loaded': {
      const last = a.entries.at(-1)?.at ?? '';
      const live = (s.logs[a.agentId] ?? []).filter((e) => e.at > last);
      return { ...s, logs: { ...s.logs, [a.agentId]: [...a.entries, ...live].slice(-LOG_CAP) } };
    }
    case 'event': return applyEvent(s, a.event);
  }
}

function applyEvent(s: UiState, e: WorkspaceEvent): UiState {
  if (e.type === 'error') return { ...s, errors: [...s.errors, e.message].slice(-5) };
  if (e.type === 'agent-event') {
    const prev = s.logs[e.agentId] ?? [];
    return { ...s, logs: { ...s.logs, [e.agentId]: [...prev, { at: e.at, event: e.event }].slice(-LOG_CAP) } };
  }
  if (!s.ws) return s;
  switch (e.type) {
    case 'agents': {
      const v = s.view;
      const gone = v.name === 'agent' && !e.agents.some((x) => x.id === v.agentId);
      return { ...s, ws: { ...s.ws, agents: e.agents }, view: gone ? { name: 'team' } : v };
    }
    case 'tasks': return { ...s, ws: { ...s.ws, tasks: e.tasks } };
    case 'chat': return { ...s, ws: { ...s.ws, chat: [...s.ws.chat, e.entry] } };
    case 'project': return { ...s, ws: { ...s.ws, project: e.project } };
    case 'merge-request': return { ...s, ws: { ...s.ws, merges: [...s.ws.merges.filter((m) => m.requestId !== e.request.requestId), e.request] } };
    case 'merge-resolved': return { ...s, ws: { ...s.ws, merges: s.ws.merges.filter((m) => m.requestId !== e.requestId) } };
  }
}
```

In `src/renderer/src/components/TeamPanel.tsx` change the log mapping to `(selected ? logs[selected] ?? [] : []).map((entry) => logLine(entry.event))` and its prop type to `Record<string, LogEntry[]>` so the old UI keeps compiling until Task 4 deletes it.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/renderer/src/state.test.ts`
Expected: PASS.

- [ ] **Step 5: Extend `src/shared/ipc.ts`**

```ts
import type { Agent, AppSettings, AppStatus, LogEntry, OpenOptions, Project, ProjectPatch, Role, Skill, WorkspaceEvent, WorkspaceSnapshot } from './types';

export const IPC = {
  appStatus: 'app:status',
  pickFolder: 'project:pick-folder',
  listProjects: 'project:list',
  openProject: 'project:open',
  closeProject: 'project:close',
  updateProject: 'project:update',
  snapshot: 'project:snapshot',
  sendToBoss: 'boss:send',
  listRoles: 'team:roles',
  saveRole: 'team:save-role',
  listSkills: 'team:skills',
  saveSkill: 'team:save-skill',
  hire: 'team:hire',
  fireAgent: 'team:fire',
  agentLog: 'agent:log',
  messageAgent: 'agent:message',
  openWorktree: 'agent:open-worktree',
  pauseTask: 'task:pause',
  resumeTask: 'task:resume',
  cancelTask: 'task:cancel',
  answerMerge: 'merge:answer',
  getSettings: 'settings:get',
  saveSettings: 'settings:save',
  event: 'workspace:event',
} as const;

export interface AgentOfficeApi {
  getStatus(): Promise<AppStatus>;
  pickFolder(): Promise<string | null>;
  listProjects(): Promise<Project[]>;
  openProject(repoPath: string, opts?: OpenOptions): Promise<WorkspaceSnapshot>;
  closeProject(): Promise<void>;
  updateProject(patch: ProjectPatch): Promise<Project>;
  snapshot(): Promise<WorkspaceSnapshot | null>;
  sendToBoss(text: string): Promise<void>;
  listRoles(): Promise<Role[]>;
  saveRole(role: Role): Promise<Role>;
  listSkills(): Promise<Skill[]>;
  saveSkill(skill: Skill): Promise<Skill>;
  hire(roleId: string, name?: string): Promise<Agent>;
  fireAgent(agentId: string): Promise<void>;
  agentLog(agentId: string): Promise<LogEntry[]>;
  messageAgent(agentId: string, text: string): Promise<void>;
  openWorktree(agentId: string): Promise<void>;
  pauseTask(id: string): Promise<void>;
  resumeTask(id: string): Promise<void>;
  cancelTask(id: string): Promise<void>;
  answerMerge(requestId: string, ok: boolean): Promise<void>;
  getSettings(): Promise<AppSettings>;
  saveSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  onEvent(cb: (e: WorkspaceEvent) => void): () => void;
}
```

- [ ] **Step 6: Extend `src/preload/index.ts`** — add to the `api` object:

```ts
  openProject: (repoPath, opts) => ipcRenderer.invoke(IPC.openProject, repoPath, opts),
  closeProject: () => ipcRenderer.invoke(IPC.closeProject),
  updateProject: (patch) => ipcRenderer.invoke(IPC.updateProject, patch),
  saveRole: (role) => ipcRenderer.invoke(IPC.saveRole, role),
  listSkills: () => ipcRenderer.invoke(IPC.listSkills),
  saveSkill: (skill) => ipcRenderer.invoke(IPC.saveSkill, skill),
  fireAgent: (agentId) => ipcRenderer.invoke(IPC.fireAgent, agentId),
  agentLog: (agentId) => ipcRenderer.invoke(IPC.agentLog, agentId),
  messageAgent: (agentId, text) => ipcRenderer.invoke(IPC.messageAgent, agentId, text),
  openWorktree: (agentId) => ipcRenderer.invoke(IPC.openWorktree, agentId),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  saveSettings: (patch) => ipcRenderer.invoke(IPC.saveSettings, patch),
```
(replace the old one-argument `openProject` line).

- [ ] **Step 7: Rewrite the bootstrap part of `src/main/index.ts`**

Keep `createWindow`, `str`, `resourcesDir` and the quit handling. Replace imports, `registerIpc` and `whenReady` with:

```ts
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { IPC } from '../shared/ipc';
import type { AppSettings, AppStatus } from '../shared/types';
import { getAppStatus } from './appStatus';
import { claudeVersion, systemLocateEnv } from './claude/locate';
import { fixGuiPath } from './claude/shellPath';
import { dataPaths } from './store/paths';
import { SettingsStore } from './store/settingsStore';
import { ProjectService } from './workspace/projectService';

// Test-only overrides (see README "Develop").
if (process.env.AO_USER_DATA) app.setPath('userData', process.env.AO_USER_DATA);
const TEST_BIN = process.env.AO_CLAUDE_BIN;
const TEST_ARGS: string[] = (() => {
  try { const v: unknown = JSON.parse(process.env.AO_CLAUDE_ARGS ?? '[]'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; } catch { return []; }
})();

function statusFor(settings: AppSettings): AppStatus {
  if (process.env.AO_CLAUDE_MISSING === '1') return { platform: process.platform, claude: null };
  if (TEST_BIN) return { platform: process.platform, claude: { path: TEST_BIN, version: 'test' } };
  return getAppStatus({ locate: systemLocateEnv(), override: settings.claudePath ?? undefined, version: claudeVersion });
}

function registerIpc(svc: ProjectService, settings: SettingsStore, status: { current: AppStatus }): void {
  ipcMain.handle(IPC.appStatus, () => status.current);
  ipcMain.handle(IPC.pickFolder, async () => {
    if (process.env.AO_E2E_PICK_FOLDER) return process.env.AO_E2E_PICK_FOLDER;
    const r = win ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] }) : await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0] ?? null;
  });
  ipcMain.handle(IPC.listProjects, () => svc.listProjects());
  ipcMain.handle(IPC.openProject, (_e, repoPath: unknown, opts: unknown) => {
    const o = (typeof opts === 'object' && opts !== null ? opts : {}) as Record<string, unknown>;
    return svc.open(str(repoPath, 'folder'), {
      bossName: typeof o.bossName === 'string' ? o.bossName.slice(0, 40) : undefined,
      bossModel: typeof o.bossModel === 'string' ? o.bossModel.slice(0, 80) : undefined,
      bossCanHire: typeof o.bossCanHire === 'boolean' ? o.bossCanHire : undefined,
    });
  });
  ipcMain.handle(IPC.closeProject, () => svc.close());
  ipcMain.handle(IPC.updateProject, (_e, patch: unknown) => svc.updateProject(patch));
  ipcMain.handle(IPC.snapshot, () => (svc.current() ? svc.snapshot() : null));
  ipcMain.handle(IPC.sendToBoss, (_e, text: unknown) => svc.sendToBoss(str(text, 'message')));
  ipcMain.handle(IPC.listRoles, () => svc.listRoles());
  ipcMain.handle(IPC.saveRole, (_e, role: unknown) => svc.saveRole(role));
  ipcMain.handle(IPC.listSkills, () => svc.listSkills());
  ipcMain.handle(IPC.saveSkill, (_e, skill: unknown) => svc.saveSkill(skill));
  ipcMain.handle(IPC.hire, (_e, roleId: unknown, name: unknown) => svc.hire(str(roleId, 'role'), typeof name === 'string' && name.trim() ? name.slice(0, 40) : undefined));
  ipcMain.handle(IPC.fireAgent, (_e, id: unknown) => svc.fire(str(id, 'agent id')));
  ipcMain.handle(IPC.agentLog, (_e, id: unknown) => svc.agentLog(str(id, 'agent id')));
  ipcMain.handle(IPC.messageAgent, async (_e, id: unknown, text: unknown) => { await svc.messageAgent(str(id, 'agent id'), str(text, 'message')); });
  ipcMain.handle(IPC.openWorktree, async (_e, id: unknown) => {
    const problem = await shell.openPath(svc.worktreeFor(str(id, 'agent id')));
    if (problem) throw new Error(problem);
  });
  ipcMain.handle(IPC.pauseTask, (_e, id: unknown) => svc.pauseTask(str(id, 'task id')));
  ipcMain.handle(IPC.resumeTask, (_e, id: unknown) => svc.resumeTask(str(id, 'task id')));
  ipcMain.handle(IPC.cancelTask, (_e, id: unknown) => svc.cancelTask(str(id, 'task id')));
  ipcMain.handle(IPC.answerMerge, (_e, requestId: unknown, ok: unknown) => svc.answerMerge(str(requestId, 'request id'), ok === true));
  ipcMain.handle(IPC.getSettings, () => settings.get());
  ipcMain.handle(IPC.saveSettings, async (_e, patch: unknown) => {
    const next = await settings.save((typeof patch === 'object' && patch !== null ? patch : {}) as Partial<AppSettings>);
    status.current = statusFor(next);
    svc.configure({ claudeBin: status.current.claude?.path ?? 'claude', isolateUserSettings: next.isolateUserSettings });
    return next;
  });
}

app.whenReady().then(async () => {
  fixGuiPath();
  const paths = dataPaths(app.getPath('userData'));
  const settings = new SettingsStore(paths.settingsFile);
  const current = await settings.get();
  const status = { current: statusFor(current) };
  service = new ProjectService({
    paths,
    resourcesDir: resourcesDir(),
    claudeBin: status.current.claude?.path ?? 'claude',
    claudeBinArgs: TEST_ARGS.length > 0 ? TEST_ARGS : undefined,
    isolateUserSettings: current.isolateUserSettings,
  });
  await service.init();
  service.on('event', (e) => win?.webContents.send(IPC.event, e));
  registerIpc(service, settings, status);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
```

(`ProjectService.configure` comes from Task 1.)

- [ ] **Step 8: Typecheck, test, build**

Run: `npm run typecheck && npm test && npm run build`
Expected: all succeed.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(app): view routing state, full IPC surface, settings and test overrides

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: App shell, office view and the restyled boss chat

**Files:**
- Create: `src/renderer/src/components/Sidebar.tsx`, `src/renderer/src/components/Header.tsx`, `src/renderer/src/components/OfficeView.tsx`, `src/renderer/src/chat/describe.ts`, `src/renderer/src/styles/app.css`
- Rewrite: `src/renderer/src/App.tsx`, `src/renderer/src/components/BossChat.tsx`
- Delete: `src/renderer/src/components/Workspace.tsx`, `src/renderer/src/components/TeamPanel.tsx`, `src/renderer/src/styles.css`, `src/renderer/src/workspace.css`
- Test: `src/renderer/src/chat/describe.test.ts`

**Interfaces:**
- Produces: `describeToolCall(tool: string, input: Record<string, unknown>): string`; components `Sidebar`, `Header`, `OfficeView`, `BossChat` (props shown in code). `App` renders `tasks`/`team`/`settings`/`agent` views with interim components until Tasks 5–8 replace them: the existing `TaskBoard` for tasks, and a one-line notice for the others.

- [ ] **Step 1: Write the failing test** — `src/renderer/src/chat/describe.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { describeToolCall } from './describe';

describe('describeToolCall', () => {
  it('summarises the boss tools in plain words', () => {
    expect(describeToolCall('assign_task', { agent: 'Pixel', title: 'Build toggle', brief: 'x' })).toBe('Pixel: Build toggle');
    expect(describeToolCall('hire', { role_id: 'qa', name: 'Quinn' })).toBe('qa as Quinn');
    expect(describeToolCall('hire', { role_id: 'qa' })).toBe('qa');
    expect(describeToolCall('request_merge', { task_id: 'T-101' })).toBe('T-101');
    expect(describeToolCall('message_agent', { agent: 'Pixel', text: 'a'.repeat(200) })).toMatch(/^Pixel: a{60}…$/);
    expect(describeToolCall('list_team', {})).toBe('');
    expect(describeToolCall('mystery', { a: 1 })).toBe('{"a":1}');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/renderer/src/chat`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `src/renderer/src/chat/describe.ts`**

```ts
const s = (v: unknown) => (typeof v === 'string' ? v : '');
const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}…` : t);

export function describeToolCall(tool: string, input: Record<string, unknown>): string {
  switch (tool) {
    case 'assign_task': return `${s(input.agent)}: ${s(input.title)}`;
    case 'hire': return input.name ? `${s(input.role_id)} as ${s(input.name)}` : s(input.role_id);
    case 'message_agent': return `${s(input.agent)}: ${clip(s(input.text), 60)}`;
    case 'get_task':
    case 'request_merge':
    case 'cancel_task': return s(input.task_id);
    case 'report_to_user': return clip(s(input.text), 80);
    case 'list_team':
    case 'list_roles':
    case 'list_tasks': return input.status ? s(input.status) : '';
    default: return clip(JSON.stringify(input), 120);
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/renderer/src/chat`
Expected: PASS.

- [ ] **Step 5: Write the shell components**

`src/renderer/src/components/Sidebar.tsx`:
```tsx
import { useEffect, useState } from 'react';
import type { AppStatus, Project, WorkspaceSnapshot } from '../../../shared/types';
import type { View } from '../state';

interface Props { status: AppStatus; current: Project; view: View; onOpened: (ws: WorkspaceSnapshot) => void; onNavigate: (v: View) => void; onError: (m: string) => void }

export function Logo() {
  return (
    <svg width="30" height="30" viewBox="0 0 10 10" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="0" y="0" width="10" height="10" fill="#F5B942" />
      <rect x="1" y="1" width="5" height="4" fill="#14151F" />
      <rect x="2" y="2" width="3" height="1" fill="#52D1BE" />
      <rect x="3" y="5" width="1" height="1" fill="#14151F" />
      <rect x="1" y="6" width="8" height="1" fill="#8B5A34" />
      <rect x="1" y="7" width="1" height="2" fill="#8B5A34" />
      <rect x="8" y="7" width="1" height="2" fill="#8B5A34" />
      <rect x="7" y="2" width="2" height="2" fill="#14151F" />
      <rect x="7" y="4" width="2" height="2" fill="#2F9E8F" />
    </svg>
  );
}

export function Sidebar({ status, current, view, onOpened, onNavigate, onError }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  useEffect(() => { window.agentOffice.listProjects().then(setProjects, () => setProjects([])); }, [current.id]);

  const open = async (repoPath: string | null) => {
    if (!repoPath) return;
    try { onOpened(await window.agentOffice.openProject(repoPath)); } catch (e) { onError(String(e)); }
  };

  return (
    <nav className="sidebar" aria-label="Projects and library">
      <div className="brand"><Logo /> AgentOffice</div>
      <div className="side-section">
        <div className="side-title">PROJECTS</div>
        {projects.map((p) => (
          <button key={p.id} type="button" className={p.id === current.id ? 'side-item current' : 'side-item'} aria-current={p.id === current.id ? 'true' : undefined} onClick={() => (p.id === current.id ? onNavigate({ name: 'office' }) : open(p.repoPath))}>
            <span className="dot" style={{ background: p.id === current.id ? 'var(--amber)' : 'var(--blue)' }} aria-hidden="true" />
            <span className="side-label">{p.name}</span>
          </button>
        ))}
        <button type="button" className="side-item muted" onClick={async () => open(await window.agentOffice.pickFolder())}>+ New project</button>
      </div>
      <div className="side-section">
        <div className="side-title">LIBRARY</div>
        <button type="button" className={view.name === 'team' ? 'side-item current' : 'side-item'} onClick={() => onNavigate({ name: 'team' })}>Roles &amp; skills</button>
        <button type="button" className={view.name === 'settings' ? 'side-item current' : 'side-item'} onClick={() => onNavigate({ name: 'settings' })}>Settings</button>
      </div>
      <div className="cli-card">
        <div className="small" style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
          <span className="dot" style={{ background: 'var(--green)' }} aria-hidden="true" /> Claude Code connected
        </div>
        <div className="mono small muted pre">{status.claude?.version ? `v${status.claude.version}\n` : ''}{status.claude?.path}</div>
      </div>
    </nav>
  );
}
```

`src/renderer/src/components/Header.tsx`:
```tsx
import type { Project } from '../../../shared/types';
import type { View } from '../state';

const TABS: { name: 'office' | 'tasks' | 'team'; label: string }[] = [
  { name: 'office', label: 'Office' },
  { name: 'tasks', label: 'Tasks' },
  { name: 'team', label: 'Team' },
];

export function Header({ project, view, openTasks, onNavigate }: { project: Project; view: View; openTasks: number; onNavigate: (v: View) => void }) {
  return (
    <>
      <header className="header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1>{project.name}</h1>
            <span className="chip">{project.baseBranch}</span>
          </div>
          <div className="mono small muted">{project.repoPath}</div>
        </div>
        <button type="button" className="btn primary" onClick={() => onNavigate({ name: 'team' })}>+ Hire agent</button>
      </header>
      <nav className="tabs" aria-label="Project views">
        {TABS.map((t) => (
          <button key={t.name} type="button" className="tab" aria-current={view.name === t.name ? 'page' : undefined} onClick={() => onNavigate({ name: t.name })}>
            {t.label}{t.name === 'tasks' && openTasks > 0 && <span className="chip" style={{ marginLeft: 6 }}>{openTasks}</span>}
          </button>
        ))}
      </nav>
    </>
  );
}
```

`src/renderer/src/components/OfficeView.tsx`:
```tsx
import { useEffect, useState } from 'react';
import type { Role, WorkspaceSnapshot } from '../../../shared/types';
import { displayState, progress, splitTeam, statusCounts, whiteboard } from '../office/model';
import { DeskSprite } from '../sprites/DeskSprite';
import { lookFor } from '../sprites/sprite';

function useClock(): string {
  const fmt = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const [t, setT] = useState(fmt);
  useEffect(() => { const id = setInterval(() => setT(fmt()), 30_000); return () => clearInterval(id); }, []);
  return t;
}

export function OfficeView({ ws, roles, onOpenAgent, onHire }: { ws: WorkspaceSnapshot; roles: Role[]; onOpenAgent: (id: string) => void; onHire: () => void }) {
  const clock = useClock();
  const { boss, employees } = splitTeam(ws.agents);
  const states = new Map(ws.agents.map((a) => [a.id, displayState(a, ws.tasks)]));
  const counts = statusCounts([...states.values()]);
  const prog = progress(ws.tasks);
  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? id;

  return (
    <section aria-label="Office">
      <div className="status-strip small muted">
        <span className="item"><span className="dot" style={{ background: 'var(--teal)' }} />{counts.working} working</span>
        <span className="item"><span className="dot" style={{ background: 'var(--amber)' }} />{counts.thinking} thinking</span>
        <span className="item"><span className="dot" style={{ background: 'var(--blue)' }} />{counts.waiting} waiting</span>
        <span className="item"><span className="dot" style={{ background: 'var(--red)' }} />{counts.problem} need help</span>
        <span className="progress mono">tasks {prog.done}/{prog.total} done · up to {ws.project.maxConcurrent} at once</span>
      </div>
      <div className="floor">
        <div className="wall" aria-hidden="true">
          <div className="window" /><div className="window" />
          <span className="clock">{clock}</span>
          <div className="plant" />
        </div>
        <div className="corner-office">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="tag">CORNER OFFICE</span>
            {boss && (() => { const st = states.get(boss.id)!; return <DeskSprite name={boss.name} role="Boss" look={lookFor(boss, roles)} status={st.status} bubble={st.bubble} onClick={() => onOpenAgent(boss.id)} />; })()}
          </div>
          <div className="whiteboard" aria-label="Plan">
            <h3>Plan</h3>
            {whiteboard(ws.tasks, ws.agents).map((l, i) => (
              <div key={i} className="line"><span className={`mark tone-${l.tone}`}>{l.mark}</span><span>{l.text}</span></div>
            ))}
            {ws.tasks.length === 0 && <div className="line tone-todo">No tasks yet. Tell the boss what to build.</div>}
          </div>
        </div>
        <div className="desks">
          {employees.map((a) => {
            const st = states.get(a.id)!;
            return <DeskSprite key={a.id} name={a.name} role={roleName(a.roleId)} look={lookFor(a, roles)} status={st.status} bubble={st.bubble} onClick={() => onOpenAgent(a.id)} />;
          })}
          <button type="button" className="empty-desk" onClick={onHire}>
            <svg width="28" height="28" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M8 2v12M2 8h12" /></svg>
            Empty desk · hire
          </button>
        </div>
      </div>
    </section>
  );
}
```

`src/renderer/src/components/BossChat.tsx` (rewrite):
```tsx
import { useEffect, useRef, useState } from 'react';
import type { Agent, ChatEntry, Look, MergeRequest } from '../../../shared/types';
import { describeToolCall } from '../chat/describe';
import { Avatar } from '../sprites/Avatar';
import { STATUS_COLORS, STATUS_LABEL } from '../sprites/sprite';

function Entry({ e }: { e: ChatEntry }) {
  switch (e.kind) {
    case 'user': return <div className="msg user pre">{e.text}</div>;
    case 'boss': return <div className="msg boss pre">{e.text}</div>;
    case 'report': return <div className="msg report pre">{e.text}</div>;
    case 'error': return <div className="msg error pre" role="alert">{e.text}</div>;
    case 'event': return <div className="msg event small"><span className="dot" style={{ background: 'var(--green)' }} aria-hidden="true" /> <span className="pre">{e.text}</span></div>;
    case 'tool': return (
      <div className="msg tool">
        <span className="mono small tool-name">{e.tool}</span>
        <span className="small pre">{describeToolCall(e.tool, e.input)}</span>
      </div>
    );
  }
}

interface Props { chat: ChatEntry[]; merges: MergeRequest[]; boss: Agent | undefined; bossLook: Look; bossModel: string; onError: (m: string) => void }

export function BossChat({ chat, merges, boss, bossLook, bossModel, onError }: Props) {
  const [draft, setDraft] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [chat.length, merges.length]);

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    try { await window.agentOffice.sendToBoss(text); } catch (e) { onError(String(e)); setDraft(text); }
  };
  const answer = (id: string, ok: boolean) => { window.agentOffice.answerMerge(id, ok).catch((e: unknown) => onError(String(e))); };
  const status = boss?.status ?? 'idle';

  return (
    <section className="chat" aria-label="Boss chat">
      <div className="chat-head">
        <Avatar look={bossLook} size={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{boss?.name ?? 'Boss'} <span className="muted" style={{ fontWeight: 400 }}>· Boss</span></div>
          <div className="mono small muted">claude · {bossModel}</div>
        </div>
        <span className="status-chip" style={{ background: STATUS_COLORS[status].dot }}>{STATUS_LABEL[status]}</span>
      </div>
      <div className="messages">
        {chat.length === 0 && <p className="muted">Tell the boss what to build. It will hire people and hand out tasks.</p>}
        {chat.map((e, i) => <Entry key={i} e={e} />)}
        {merges.map((m) => (
          <div key={m.requestId} className="merge-card" role="group" aria-label={`Merge request for ${m.taskId}`}>
            <div><strong>Merge {m.taskId}?</strong> {m.title} <span className="muted">by {m.agentName}</span></div>
            {m.summary && <p className="small pre">{m.summary}</p>}
            {m.diffStat.length > 0 && <ul className="mono small files">{m.diffStat.map((f) => <li key={f.path}>{f.path} <span className="add">+{f.add}</span> <span className="del">−{f.del}</span></li>)}</ul>}
            <div className="row">
              <button type="button" className="btn primary small" onClick={() => answer(m.requestId, true)}>Merge</button>
              <button type="button" className="btn small" onClick={() => answer(m.requestId, false)}>Decline</button>
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <label htmlFor="boss-msg" className="small muted">Message the boss</label>
        <textarea id="boss-msg" className="input" rows={3} value={draft} placeholder="Describe what the team should build…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
        <div className="row">
          <span className="small muted">Enter to send · Shift+Enter for a new line</span>
          <button type="submit" className="btn teal" style={{ marginLeft: 'auto' }}>Send</button>
        </div>
      </form>
    </section>
  );
}
```

`src/renderer/src/App.tsx` (rewrite):
```tsx
import { useCallback, useEffect, useReducer, useState } from 'react';
import type { AppStatus } from '../../shared/types';
import { BossChat } from './components/BossChat';
import { Header } from './components/Header';
import { OfficeView } from './components/OfficeView';
import { Onboarding } from './components/Onboarding';
import { Sidebar } from './components/Sidebar';
import { TaskBoard } from './components/TaskBoard';
import { lookFor } from './sprites/sprite';
import { initialState, reducer, type View } from './state';

const clean = (m: string) => m.replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '');

export function App() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [state, dispatch] = useReducer(reducer, initialState);
  const onError = useCallback((m: string) => dispatch({ type: 'error', message: clean(m) }), []);
  const refreshRoles = useCallback(() => { window.agentOffice.listRoles().then((roles) => dispatch({ type: 'roles', roles }), () => undefined); }, []);

  useEffect(() => {
    window.agentOffice.getStatus().then(setStatus, () => setStatus({ platform: 'unknown', claude: null }));
    window.agentOffice.snapshot().then((ws) => { if (ws) dispatch({ type: 'snapshot', ws }); }, () => undefined);
    refreshRoles();
    return window.agentOffice.onEvent((event) => dispatch({ type: 'event', event }));
  }, [refreshRoles]);

  if (!status) return <main className="boot"><p>Looking for Claude Code…</p></main>;
  if (!status.claude) {
    return (
      <main className="boot">
        <h1 className="pixel">AgentOffice</h1>
        <p className="bad">Claude Code was not found on this computer. Install it, sign in with <code>claude</code> once in a terminal, then restart AgentOffice.</p>
      </main>
    );
  }
  const ws = state.ws;
  if (!ws) return <Onboarding onOpened={(snap) => dispatch({ type: 'snapshot', ws: snap })} />;

  const go = (view: View) => dispatch({ type: 'navigate', view });
  const boss = ws.agents.find((a) => a.kind === 'boss');
  const bossRole = state.roles.find((r) => r.id === 'boss');
  const openTasks = ws.tasks.filter((t) => ['queued', 'working', 'needs_help', 'review'].includes(t.status)).length;
  const withChat = state.view.name === 'office' || state.view.name === 'agent';

  const view = (() => {
    switch (state.view.name) {
      case 'office': return <OfficeView ws={ws} roles={state.roles} onOpenAgent={(id) => go({ name: 'agent', agentId: id })} onHire={() => go({ name: 'team' })} />;
      case 'tasks': return <TaskBoard tasks={ws.tasks} agents={ws.agents} onError={onError} />;
      default: return <p className="muted">This view arrives in a later step.</p>;
    }
  })();

  return (
    <div className="app">
      <Sidebar status={status} current={ws.project} view={state.view} onOpened={(snap) => dispatch({ type: 'snapshot', ws: snap })} onNavigate={go} onError={onError} />
      <div className="main">
        <Header project={ws.project} view={state.view} openTasks={openTasks} onNavigate={go} />
        {state.errors.length > 0 && (
          <div className="errors" role="alert">
            {state.errors.map((m, i) => (
              <div key={i} className="error-row"><span className="pre">{m}</span><button type="button" className="btn small" aria-label="Dismiss error" onClick={() => dispatch({ type: 'dismiss-error', index: i })}>×</button></div>
            ))}
          </div>
        )}
        <div className="content">
          <div className="view">{view}</div>
          {withChat && (
            <aside className="chat-panel">
              <BossChat chat={ws.chat} merges={ws.merges} boss={boss} bossLook={boss ? lookFor(boss, state.roles) : lookFor({ roleId: 'boss' }, state.roles)} bossModel={bossRole?.model ?? 'opus'} onError={onError} />
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
```

`src/renderer/src/styles/app.css` (all view styles; later tasks use these classes):
```css
.boot { padding: 48px; max-width: 720px; }
.row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.app { height: 100vh; display: grid; grid-template-columns: 248px minmax(0, 1fr); }
.sidebar { background: #171824; border-right: 1px solid var(--line); padding: 20px 14px; display: flex; flex-direction: column; gap: 22px; overflow-y: auto; }
.brand { display: flex; align-items: center; gap: 10px; padding: 0 6px; font-family: var(--font-pixel); font-weight: 700; font-size: 20px; }
.side-section { display: flex; flex-direction: column; gap: 2px; }
.side-title { font-size: 11px; letter-spacing: 1.2px; color: var(--muted); padding: 0 8px 6px; }
.side-item { display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: 6px; background: none; border: 0; text-align: left; width: 100%; min-height: 40px; color: var(--text); }
.side-item.muted { color: var(--muted); }
.side-item:hover { background: #20222f; }
.side-item.current { background: #262939; font-weight: 600; }
.side-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cli-card { margin-top: auto; border: 1px solid var(--line); background: var(--panel-2); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 6px; }
.main { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 18px 28px 0; }
.header h1 { margin: 0; font-family: var(--font-pixel); font-size: 26px; overflow-wrap: anywhere; }
.tabs { display: flex; gap: 4px; padding: 12px 28px 0; border-bottom: 1px solid var(--line); }
.tab { background: none; border: 0; border-bottom: 2px solid transparent; padding: 10px 14px; color: var(--muted); min-height: 40px; }
.tab[aria-current='page'] { color: var(--text); font-weight: 600; border-bottom-color: var(--amber); }
.errors { padding: 8px 28px; background: #3d1c1c; display: flex; flex-direction: column; gap: 6px; }
.error-row { display: flex; justify-content: space-between; gap: 12px; align-items: center; color: #ffd0ca; }
.content { flex: 1; min-height: 0; display: flex; }
.view { flex: 1; min-width: 0; overflow: auto; padding: 16px 28px 28px; }
.chat-panel { width: 380px; flex: none; border-left: 1px solid var(--line); background: var(--panel); display: flex; min-height: 0; }
.status-strip { display: flex; flex-wrap: wrap; gap: 18px; padding: 0 0 12px; }
.status-strip .item { display: flex; align-items: center; gap: 6px; }
.status-strip .progress { margin-left: auto; }
.chat { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.chat-head { display: flex; align-items: center; gap: 12px; padding: 16px 18px; border-bottom: 1px solid var(--line); }
.status-chip { font-size: 12px; font-weight: 600; color: var(--amber-ink); padding: 3px 8px; border-radius: 3px; }
.messages { flex: 1; overflow-y: auto; padding: 16px 18px; display: flex; flex-direction: column; gap: 12px; }
.msg { padding: 9px 12px; border-radius: 10px; max-width: 92%; overflow-wrap: anywhere; }
.msg.user { align-self: flex-end; background: var(--amber); color: var(--amber-ink); border-radius: 10px 10px 2px 10px; }
.msg.boss { background: #232536; border-radius: 10px 10px 10px 2px; }
.msg.report { background: #123b37; border: 1px solid var(--teal); }
.msg.error { background: #3d1c1c; color: #ffd0ca; }
.msg.event { color: var(--muted); border-top: 1px dashed var(--line-2); border-radius: 0; max-width: 100%; padding: 8px 0 0; }
.msg.tool { border: 1px solid var(--line-2); background: var(--panel-2); border-radius: 6px; display: flex; flex-direction: column; gap: 4px; max-width: 100%; }
.tool-name { color: var(--teal); }
.merge-card { border: 2px solid var(--amber); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.files { list-style: none; margin: 0; padding: 0; }
.composer { border-top: 1px solid var(--line); padding: 12px 18px 16px; display: flex; flex-direction: column; gap: 8px; }
.composer textarea { resize: none; }
.board-head { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.board-columns { display: grid; grid-template-columns: repeat(5, minmax(210px, 1fr)); gap: 14px; overflow-x: auto; padding-bottom: 8px; }
.column { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 10px; min-height: 420px; }
.column h2 { margin: 0; font-size: 14px; display: flex; align-items: center; gap: 8px; }
.card { background: var(--card); border: 1px solid #33374a; border-radius: 6px; padding: 12px; display: flex; flex-direction: column; gap: 8px; box-shadow: 0 2px 0 #0e0f16; overflow-wrap: anywhere; }
.card-title { font-weight: 500; }
.card-meta { display: flex; gap: 8px; font-family: var(--font-mono); font-size: 11px; color: var(--muted); }
.detail-top { display: flex; flex-wrap: wrap; gap: 24px; align-items: stretch; }
.detail-desk { flex: 0 1 260px; background: repeating-conic-gradient(#3a2e29 0 25%, #42352f 0 50%) 0 0 / 48px 48px; border: 3px solid #0e0f16; box-shadow: 0 0 0 3px var(--line); display: flex; align-items: center; justify-content: center; padding: 12px; }
.meta { margin: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 24px; font-size: 13px; }
.meta dt { color: var(--muted); } .meta dd { margin: 2px 0 0; font-family: var(--font-mono); overflow-wrap: anywhere; }
.panel-box { background: var(--panel-2); border: 1px solid var(--line); border-radius: 8px; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
.log { background: #0f1018; border: 1px solid var(--line); border-radius: 8px; padding: 12px 16px; font-family: var(--font-mono); font-size: 13px; display: flex; flex-direction: column; gap: 8px; max-height: 520px; overflow-y: auto; }
.log-line { display: grid; grid-template-columns: 72px 64px minmax(0, 1fr); gap: 12px; overflow-wrap: anywhere; }
.log-time { color: var(--faint); }
.tone-tool { color: var(--teal); } .tone-result { color: var(--green); } .tone-text { color: var(--text); } .tone-bad { color: var(--red-soft); } .tone-meta { color: var(--muted); }
.team-layout { display: flex; flex-wrap: wrap; gap: 24px; }
.team-col { flex: 1 1 360px; min-width: 0; display: flex; flex-direction: column; gap: 20px; }
.role-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.role-card { text-align: left; display: flex; align-items: center; gap: 10px; padding: 10px; background: var(--panel-2); border: 2px solid var(--line); border-radius: 8px; min-height: 60px; color: var(--text); }
.role-card[aria-pressed='true'] { border-color: var(--amber); background: #262939; }
.team-row { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 10px 12px; background: var(--panel-2); border: 1px solid var(--line); border-radius: 8px; }
.editor { flex: 999 1 460px; min-width: 0; background: var(--panel-2); border: 1px solid var(--line); border-radius: 10px; padding: 20px; display: flex; flex-direction: column; gap: 16px; }
.grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.toggle { min-height: 36px; padding: 0 12px; border-radius: 18px; border: 1px solid var(--line-2); background: transparent; color: var(--muted); font: 500 13px var(--font-mono); }
.toggle[aria-pressed='true'] { background: #123b37; border-color: var(--teal); color: #7fe6d5; }
.skill-row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: #11121b; border: 1px solid var(--line); border-radius: 6px; }
.warn { color: var(--amber); font-size: 13px; }
.settings { max-width: 720px; display: flex; flex-direction: column; gap: 20px; }
.onboarding-wrap { min-height: 100vh; padding: 48px 16px; background: repeating-conic-gradient(#191a26 0 25%, #1c1d2a 0 50%) 0 0 / 48px 48px; display: flex; align-items: center; justify-content: center; }
.onboarding-card { width: 100%; max-width: 980px; display: flex; flex-wrap: wrap; background: var(--panel); border: 3px solid #0e0f16; box-shadow: 0 0 0 3px var(--line), 8px 8px 0 rgba(0,0,0,.4); }
.onboarding-art { flex: 1 1 320px; background: repeating-conic-gradient(#3a2e29 0 25%, #42352f 0 50%) 0 0 / 48px 48px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 36px 24px; text-align: center; }
.onboarding-form { flex: 999 1 420px; min-width: 0; padding: 32px; display: flex; flex-direction: column; gap: 22px; }
.step { display: flex; gap: 14px; }
.step-badge { flex: 0 0 32px; height: 32px; display: flex; align-items: center; justify-content: center; font-family: var(--font-pixel); font-size: 16px; background: #262939; color: var(--muted); }
.step-badge.done { background: var(--green); color: #12240d; } .step-badge.active { background: var(--amber); color: var(--amber-ink); }
@media (max-width: 1200px) { .chat-panel { width: 320px; } }
@media (max-width: 1060px) {
  .app { grid-template-columns: 200px minmax(0, 1fr); }
  .content { flex-direction: column; }
  .chat-panel { width: auto; height: 45vh; border-left: 0; border-top: 1px solid var(--line); }
}
```

Delete the old files: `git rm src/renderer/src/components/Workspace.tsx src/renderer/src/components/TeamPanel.tsx src/renderer/src/styles.css src/renderer/src/workspace.css`. Restyle `Onboarding.tsx` only enough to compile with the new CSS; Task 8 rewrites it. Its classes `primary` and `recent` become `btn primary`; keep the rest.

- [ ] **Step 6: Typecheck, test, build, look at it**

Run: `npm run typecheck && npm test && npm run build`
Then run the app against the fake CLI with a scratch repo (`AO_CLAUDE_BIN=$(node -p process.execPath) AO_CLAUDE_ARGS='["'$PWD'/test/fake-claude/fake-claude.mjs"]' FAKE_CLAUDE_FILE=notes.txt npm run dev`). Open a scratch git repo created under the system temp folder (never a real project), and take a screenshot.
Expected: the office from the design. You should see the wall with windows and a clock, the boss in the corner office next to the Plan whiteboard, the empty desk, the status strip, and the chat on the right. Sending "hello" shows "echo: hello".

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(ui): app shell, pixel office view and restyled boss chat

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Agent detail view with the live session

**Files:**
- Create: `src/renderer/src/agent/logView.ts`, `src/renderer/src/components/AgentDetailView.tsx`
- Modify: `src/renderer/src/App.tsx` (render it for `view.name === 'agent'`)
- Test: `src/renderer/src/agent/logView.test.ts`

**Interfaces:**
- Produces:
```ts
export interface LogLine { time: string; kind: string; text: string; tone: 'tool' | 'result' | 'text' | 'bad' | 'meta' }
export function formatLog(entry: LogEntry): LogLine | null;
export function currentTask(agentId: string, tasks: Task[]): Task | undefined;
export function AgentDetailView(p: { ws: WorkspaceSnapshot; roles: Role[]; agentId: string; logs: LogEntry[]; onBack(): void; onLogs(entries: LogEntry[]): void; onError(m: string): void }): JSX.Element;
```

- [ ] **Step 1: Write the failing test** — `src/renderer/src/agent/logView.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { currentTask, formatLog } from './logView';
import type { Task } from '../../../shared/types';

const at = '2026-10-14T14:29:10.000Z';
const local = new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

describe('formatLog', () => {
  it('formats tool calls with their key argument', () => {
    expect(formatLog({ at, event: { type: 'tool_use', id: '1', name: 'Read', input: { file_path: '/r/src/tokens.css' } } })).toEqual({ time: local, kind: 'tool', text: 'Read /r/src/tokens.css', tone: 'tool' });
    expect(formatLog({ at, event: { type: 'tool_use', id: '1', name: 'Bash', input: { command: 'npm test' } } })!.text).toBe('Bash npm test');
    expect(formatLog({ at, event: { type: 'tool_use', id: '1', name: 'X', input: { a: 1 } } })!.text).toBe('X {"a":1}');
  });

  it('formats results, text, errors and lifecycle events', () => {
    expect(formatLog({ at, event: { type: 'tool_result', toolUseId: '1', isError: false, preview: 'line one\nline two' } })).toMatchObject({ kind: 'result', text: 'line one', tone: 'result' });
    expect(formatLog({ at, event: { type: 'tool_result', toolUseId: '1', isError: true, preview: 'boom' } })).toMatchObject({ tone: 'bad' });
    expect(formatLog({ at, event: { type: 'text', text: 'Hello there' } })).toMatchObject({ kind: 'text', text: 'Hello there', tone: 'text' });
    expect(formatLog({ at, event: { type: 'result', ok: true, text: 'Done', sessionId: 's', costUsd: 0, durationMs: 0, numTurns: 1 } })).toMatchObject({ kind: 'done', tone: 'result' });
    expect(formatLog({ at, event: { type: 'result', ok: false, text: 'nope', sessionId: 's', costUsd: 0, durationMs: 0, numTurns: 1 } })).toMatchObject({ kind: 'failed', tone: 'bad' });
    expect(formatLog({ at, event: { type: 'stderr', text: 'warn' } })).toMatchObject({ kind: 'stderr', tone: 'bad' });
    expect(formatLog({ at, event: { type: 'init', sessionId: 's', model: 'sonnet' } })).toMatchObject({ kind: 'start', text: 'session started (sonnet)', tone: 'meta' });
    expect(formatLog({ at, event: { type: 'exit', code: 0, signal: null } })).toMatchObject({ kind: 'exit', text: 'session ended (0)' });
    expect(formatLog({ at, event: { type: 'thinking' } })).toBeNull();
  });
});

describe('currentTask', () => {
  const t = (id: string, status: Task['status'], updatedAt: string): Task => ({ id, projectId: 'p', title: id, brief: '', assigneeId: 'a', createdBy: 'boss', status, held: false, attempts: 0, branch: 'b', dependsOn: [], createdAt: '', updatedAt });
  it('prefers running work, then the most recently touched open task', () => {
    expect(currentTask('a', [t('T-1', 'review', '2'), t('T-2', 'working', '1')])!.id).toBe('T-2');
    expect(currentTask('a', [t('T-1', 'review', '1'), t('T-3', 'needs_help', '3')])!.id).toBe('T-3');
    expect(currentTask('a', [t('T-1', 'done', '9')])).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/renderer/src/agent`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `src/renderer/src/agent/logView.ts`**

```ts
import type { LogEntry, Task } from '../../../shared/types';

export interface LogLine { time: string; kind: string; text: string; tone: 'tool' | 'result' | 'text' | 'bad' | 'meta' }

const time = (at: string) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const firstLine = (s: string) => s.split('\n')[0] ?? '';

function keyArg(input: Record<string, unknown>): string {
  for (const k of ['file_path', 'command', 'pattern', 'url', 'agent', 'task_id']) {
    if (typeof input[k] === 'string') return input[k] as string;
  }
  const json = JSON.stringify(input);
  return json.length > 120 ? `${json.slice(0, 119)}…` : json;
}

export function formatLog(entry: LogEntry): LogLine | null {
  const e = entry.event;
  const t = time(entry.at);
  switch (e.type) {
    case 'tool_use': return { time: t, kind: 'tool', text: `${e.name} ${keyArg(e.input)}`, tone: 'tool' };
    case 'tool_result': return { time: t, kind: 'result', text: firstLine(e.preview), tone: e.isError ? 'bad' : 'result' };
    case 'text': return { time: t, kind: 'text', text: e.text, tone: 'text' };
    case 'result': return e.ok ? { time: t, kind: 'done', text: firstLine(e.text), tone: 'result' } : { time: t, kind: 'failed', text: firstLine(e.text), tone: 'bad' };
    case 'stderr': return { time: t, kind: 'stderr', text: e.text, tone: 'bad' };
    case 'init': return { time: t, kind: 'start', text: `session started (${e.model})`, tone: 'meta' };
    case 'exit': return { time: t, kind: 'exit', text: `session ended (${e.code ?? e.signal})`, tone: 'meta' };
    default: return null;
  }
}

const OPEN: Task['status'][] = ['working', 'needs_help', 'review', 'queued'];

export function currentTask(agentId: string, tasks: Task[]): Task | undefined {
  const mine = tasks.filter((t) => t.assigneeId === agentId && OPEN.includes(t.status));
  return mine.find((t) => t.status === 'working') ?? mine.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/renderer/src/agent`
Expected: PASS.

- [ ] **Step 5: Write `src/renderer/src/components/AgentDetailView.tsx`**

```tsx
import { useEffect, useState } from 'react';
import type { LogEntry, Role, WorkspaceSnapshot } from '../../../shared/types';
import { currentTask, formatLog } from '../agent/logView';
import { displayState } from '../office/model';
import { DeskSprite } from '../sprites/DeskSprite';
import { STATUS_COLORS, STATUS_LABEL, lookFor } from '../sprites/sprite';

interface Props { ws: WorkspaceSnapshot; roles: Role[]; agentId: string; logs: LogEntry[]; onBack: () => void; onLogs: (entries: LogEntry[]) => void; onError: (m: string) => void }

export function AgentDetailView({ ws, roles, agentId, logs, onBack, onLogs, onError }: Props) {
  const [message, setMessage] = useState('');
  const agent = ws.agents.find((a) => a.id === agentId);
  useEffect(() => { window.agentOffice.agentLog(agentId).then(onLogs, () => undefined); }, [agentId, onLogs]);
  if (!agent) return <p className="muted">That agent is no longer on the team.</p>;

  const role = roles.find((r) => r.id === agent.roleId);
  const st = displayState(agent, ws.tasks);
  const task = currentTask(agent.id, ws.tasks);
  const isBoss = agent.kind === 'boss';
  const lines = logs.map(formatLog).filter((l) => l !== null);
  const live = st.status === 'working' || st.status === 'thinking';
  const act = (fn: () => Promise<void>) => () => { fn().catch((e: unknown) => onError(String(e))); };

  const send = async () => {
    const text = message.trim();
    if (!text) return;
    try { await window.agentOffice.messageAgent(agent.id, text); setMessage(''); } catch (e) { onError(String(e)); }
  };

  return (
    <section aria-label={`${agent.name} details`} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div><button type="button" className="btn small" onClick={onBack}>← Back to office</button></div>
      <div className="detail-top">
        <div className="detail-desk">
          <DeskSprite name={agent.name} role={isBoss ? 'Boss' : role?.name ?? agent.roleId} look={lookFor(agent, roles)} status={st.status} bubble={st.bubble} />
        </div>
        <div style={{ flex: '999 1 420px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="row">
            <h2 className="pixel" style={{ margin: 0, fontSize: 30, overflowWrap: 'anywhere' }}>{agent.name}</h2>
            <span className="muted">{isBoss ? 'Boss' : role?.name}</span>
            <span className="status-chip" style={{ background: STATUS_COLORS[st.status].dot }}>{STATUS_LABEL[st.status]}</span>
          </div>
          <dl className="meta">
            <div><dt>Model</dt><dd>claude · {role?.model ?? '?'}</dd></div>
            <div><dt>Permissions</dt><dd>{role?.permissionMode ?? '?'}</dd></div>
            <div><dt>Worktree</dt><dd>{agent.worktreePath ? `.agentoffice/wt/${agent.worktreePath.split(/[\\/]/).pop()}` : '—'}</dd></div>
            <div><dt>Branch</dt><dd>{task?.branch ?? '—'}</dd></div>
          </dl>
          {role && role.skills.length > 0 && <div className="row">{role.skills.map((s) => <span key={s} className="chip">{s}</span>)}</div>}
          {!isBoss && (
            <div className="row">
              {task?.status === 'working' && <button type="button" className="btn" onClick={act(() => window.agentOffice.pauseTask(task.id))}>Pause</button>}
              {task?.status === 'queued' && task.held && <button type="button" className="btn" onClick={act(() => window.agentOffice.resumeTask(task.id))}>Resume</button>}
              {agent.worktreePath && <button type="button" className="btn" onClick={act(() => window.agentOffice.openWorktree(agent.id))}>Open worktree</button>}
              {task && <button type="button" className="btn danger" onClick={act(() => window.agentOffice.cancelTask(task.id))}>Cancel {task.id}</button>}
            </div>
          )}
        </div>
      </div>

      {isBoss ? (
        <p className="muted">The boss's conversation is in the chat on the right.</p>
      ) : (
        <div className="row" style={{ alignItems: 'stretch' }}>
          <section aria-label="Live session" style={{ flex: '999 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="row"><strong>Live session</strong>{live && <span className="small" style={{ color: 'var(--teal)' }}>● streaming</span>}</div>
            <div className="log" aria-live="polite">
              {lines.length === 0 && <span className="muted">No activity yet.</span>}
              {lines.map((l, i) => (
                <div key={i} className="log-line"><span className="log-time">{l.time}</span><span className={`tone-${l.tone}`}>{l.kind}</span><span className={l.tone === 'result' ? 'muted' : ''}>{l.text}</span></div>
              ))}
              {live && <div className="log-line"><span /><span /><span className="cursor-blink" style={{ color: 'var(--teal)' }} aria-hidden="true">▌</span></div>}
            </div>
            <form className="row" onSubmit={(e) => { e.preventDefault(); void send(); }}>
              <label htmlFor="agent-msg" className="sr-only">Message {agent.name}</label>
              <input id="agent-msg" className="input" style={{ flex: 1, minWidth: 200 }} placeholder={`Message ${agent.name}…`} value={message} onChange={(e) => setMessage(e.target.value)} />
              <button type="submit" className="btn teal">Send</button>
            </form>
          </section>
          <div style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <section className="panel-box" aria-label="Current task">
              {task ? (
                <>
                  <div className="card-meta"><span>{task.id}</span><span>from {task.createdBy === 'boss' ? 'the boss' : 'you'}</span><span>{task.status}</span></div>
                  <h3 style={{ margin: 0, fontSize: 16 }}>{task.title}</h3>
                  <p className="small pre" style={{ margin: 0, color: '#c9cbd8' }}>{task.brief}</p>
                </>
              ) : <p className="muted" style={{ margin: 0 }}>No open task.</p>}
            </section>
            {task?.diffStat && task.diffStat.length > 0 && (
              <section className="panel-box" aria-label="Changes">
                <h3 style={{ margin: 0, fontSize: 14 }}>Changes on branch</h3>
                <ul className="files mono small">{task.diffStat.map((f) => <li key={f.path} className="row"><span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{f.path}</span><span className="add">+{f.add}</span><span className="del">−{f.del}</span></li>)}</ul>
              </section>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
```

In `App.tsx`, add the import and the case:
```tsx
      case 'agent': return <AgentDetailView ws={ws} roles={state.roles} agentId={state.view.agentId} logs={state.logs[state.view.agentId] ?? []} onBack={() => go({ name: 'office' })} onLogs={onLogs} onError={onError} />;
```
with `const onLogs = useCallback((entries: LogEntry[]) => { if (state.view.name === 'agent') dispatch({ type: 'logs-loaded', agentId: state.view.agentId, entries }); }, [state.view]);` declared with the other callbacks (import `LogEntry`). Declare it before the early returns, so the hooks order never changes between renders.

- [ ] **Step 6: Typecheck, test, build, look**

Run: `npm run typecheck && npm test && npm run build`. Then check in the dev app: hire someone and send the boss a task (with the fake CLI, use the boss tools via chat → "echo" only). An easier route: hire Pixel in the Team tab, then in the scratch repo run a task through the agent's Message box. The agent detail page shows the session lines and the current task.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(ui): agent detail page with live session, current task and actions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Task board

**Files:**
- Create: `src/renderer/src/tasks/board.ts`
- Rewrite: `src/renderer/src/components/TaskBoard.tsx`
- Modify: `src/renderer/src/App.tsx`
- Test: `src/renderer/src/tasks/board.test.ts`

**Interfaces:**
- Produces:
```ts
export const COLUMNS: { title: string; statuses: TaskStatus[]; color: string }[];
export function cardMeta(task: Task, tasks: Task[]): string;
export function filterTasks(tasks: Task[], assigneeId: string | 'all'): Task[];
export function TaskBoard(p: { ws: WorkspaceSnapshot; roles: Role[]; onOpenAgent(id: string): void; onNewTask(): void; onError(m: string): void }): JSX.Element;
```

- [ ] **Step 1: Write the failing test** — `src/renderer/src/tasks/board.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { COLUMNS, cardMeta, filterTasks } from './board';
import type { Task } from '../../../shared/types';

const t = (over: Partial<Task>): Task => ({ id: 'T-1', projectId: 'p', title: 't', brief: '', assigneeId: 'a', createdBy: 'boss', status: 'queued', held: false, attempts: 0, branch: 'b', dependsOn: [], createdAt: '', updatedAt: '', ...over });

describe('task board helpers', () => {
  it('covers every status exactly once', () => {
    const all = COLUMNS.flatMap((c) => c.statuses).sort();
    expect(all).toEqual(['cancelled', 'done', 'failed', 'needs_help', 'queued', 'review', 'working']);
  });

  it('describes each card', () => {
    const dep = t({ id: 'T-0', status: 'working' });
    expect(cardMeta(t({ dependsOn: ['T-0'] }), [dep])).toBe('blocked by T-0');
    expect(cardMeta(t({ dependsOn: ['T-0'] }), [{ ...dep, status: 'done' }])).toBe('queued');
    expect(cardMeta(t({ held: true }), [])).toBe('paused');
    expect(cardMeta(t({ status: 'working', attempts: 1 }), [])).toBe('running');
    expect(cardMeta(t({ status: 'working', attempts: 3 }), [])).toBe('attempt 3');
    expect(cardMeta(t({ status: 'review', diffStat: [{ path: 'a', add: 1, del: 0 }, { path: 'b', add: 1, del: 0 }] }), [])).toBe('2 files');
    expect(cardMeta(t({ status: 'needs_help' }), [])).toBe('needs help');
    expect(cardMeta(t({ status: 'done' }), [])).toBe('merged');
    expect(cardMeta(t({ status: 'cancelled' }), [])).toBe('cancelled');
  });

  it('filters by assignee', () => {
    const list = [t({ id: 'A', assigneeId: 'x' }), t({ id: 'B', assigneeId: 'y' })];
    expect(filterTasks(list, 'all')).toHaveLength(2);
    expect(filterTasks(list, 'y').map((x) => x.id)).toEqual(['B']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/renderer/src/tasks`
Expected: FAIL.

- [ ] **Step 3: Write `src/renderer/src/tasks/board.ts`**

```ts
import type { Task, TaskStatus } from '../../../shared/types';

export const COLUMNS: { title: string; statuses: TaskStatus[]; color: string }[] = [
  { title: 'Queued', statuses: ['queued'], color: 'var(--muted)' },
  { title: 'Working', statuses: ['working'], color: 'var(--teal)' },
  { title: 'Needs help', statuses: ['needs_help', 'failed'], color: 'var(--red)' },
  { title: 'Review', statuses: ['review'], color: 'var(--amber)' },
  { title: 'Done', statuses: ['done', 'cancelled'], color: 'var(--green)' },
];

export function cardMeta(task: Task, tasks: Task[]): string {
  switch (task.status) {
    case 'queued': {
      if (task.held) return 'paused';
      const blocking = task.dependsOn.filter((id) => tasks.find((x) => x.id === id)?.status !== 'done');
      return blocking.length > 0 ? `blocked by ${blocking.join(', ')}` : 'queued';
    }
    case 'working': return task.attempts > 1 ? `attempt ${task.attempts}` : 'running';
    case 'review': return `${task.diffStat?.length ?? 0} files`;
    case 'needs_help':
    case 'failed': return 'needs help';
    case 'done': return 'merged';
    case 'cancelled': return 'cancelled';
  }
}

export function filterTasks(tasks: Task[], assigneeId: string | 'all'): Task[] {
  return assigneeId === 'all' ? tasks : tasks.filter((t) => t.assigneeId === assigneeId);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/renderer/src/tasks`
Expected: PASS.

- [ ] **Step 5: Rewrite `src/renderer/src/components/TaskBoard.tsx`**

```tsx
import { useState } from 'react';
import type { Role, WorkspaceSnapshot } from '../../../shared/types';
import { Avatar } from '../sprites/Avatar';
import { lookFor } from '../sprites/sprite';
import { COLUMNS, cardMeta, filterTasks } from '../tasks/board';

interface Props { ws: WorkspaceSnapshot; roles: Role[]; onOpenAgent: (id: string) => void; onNewTask: () => void; onError: (m: string) => void }

export function TaskBoard({ ws, roles, onOpenAgent, onNewTask, onError }: Props) {
  const [who, setWho] = useState<string>('all');
  const employees = ws.agents.filter((a) => a.kind === 'employee');
  const tasks = filterTasks(ws.tasks, who);
  const act = (fn: () => Promise<void>) => () => { fn().catch((e: unknown) => onError(String(e))); };

  return (
    <section aria-label="Task board">
      <div className="board-head">
        <div className="row">
          <label htmlFor="tb-filter" className="small muted">Assignee</label>
          <select id="tb-filter" className="input" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="all">Everyone</option>
            {employees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <button type="button" className="btn primary" onClick={onNewTask}>New task for {ws.agents.find((a) => a.kind === 'boss')?.name ?? 'the boss'}</button>
      </div>
      <div className="board-columns">
        {COLUMNS.map((c) => {
          const items = tasks.filter((t) => c.statuses.includes(t.status)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
          return (
            <section key={c.title} className="column" aria-label={c.title}>
              <h2><span className="dot" style={{ background: c.color }} aria-hidden="true" />{c.title}<span className="mono small muted" style={{ marginLeft: 'auto' }}>{items.length}</span></h2>
              {items.map((t) => {
                const agent = ws.agents.find((a) => a.id === t.assigneeId);
                return (
                  <article key={t.id} className="card">
                    <div className="card-meta"><span>{t.id}</span><span style={{ marginLeft: 'auto' }}>{cardMeta(t, ws.tasks)}</span></div>
                    <div className="card-title">{t.title}</div>
                    <div className="row">
                      {agent && <Avatar look={lookFor(agent, roles)} size={22} />}
                      {agent ? <button type="button" className="btn small" onClick={() => onOpenAgent(agent.id)}>{agent.name}</button> : <span className="small muted">unassigned</span>}
                      <span className="mono small muted" style={{ marginLeft: 'auto', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.branch}>{t.branch}</span>
                    </div>
                    {t.resultSummary && (
                      <details>
                        <summary className="small">Result</summary>
                        <p className="small pre">{t.resultSummary}</p>
                        {t.diffStat && t.diffStat.length > 0 && <ul className="mono small files">{t.diffStat.map((f) => <li key={f.path}>{f.path} <span className="add">+{f.add}</span> <span className="del">−{f.del}</span></li>)}</ul>}
                      </details>
                    )}
                    <div className="row">
                      {t.status === 'working' && <button type="button" className="btn small" onClick={act(() => window.agentOffice.pauseTask(t.id))}>Pause</button>}
                      {t.status === 'queued' && t.held && <button type="button" className="btn small" onClick={act(() => window.agentOffice.resumeTask(t.id))}>Resume</button>}
                      {['queued', 'working', 'needs_help', 'review'].includes(t.status) && <button type="button" className="btn small danger" onClick={act(() => window.agentOffice.cancelTask(t.id))}>Cancel</button>}
                    </div>
                  </article>
                );
              })}
            </section>
          );
        })}
      </div>
    </section>
  );
}
```

In `App.tsx`, change the tasks case to:
```tsx
      case 'tasks': return <TaskBoard ws={ws} roles={state.roles} onOpenAgent={(id) => go({ name: 'agent', agentId: id })} onNewTask={() => { go({ name: 'office' }); setTimeout(() => document.getElementById('boss-msg')?.focus(), 0); }} onError={onError} />;
```

- [ ] **Step 6: Typecheck, test, build, commit**

Run: `npm run typecheck && npm test && npm run build`
```bash
git add -A
git commit -m "feat(ui): task board with columns, filters and card actions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Team and role editor

**Files:**
- Create: `src/renderer/src/team/roleForm.ts`, `src/renderer/src/components/TeamView.tsx`, `src/renderer/src/components/RoleEditor.tsx`
- Modify: `src/renderer/src/App.tsx`
- Test: `src/renderer/src/team/roleForm.test.ts`

**Interfaces:**
- Produces:
```ts
export const KNOWN_TOOLS: string[];
export const MODELS: string[];
export function toggle(list: string[], item: string): string[];
export function roleIdFromName(name: string, taken: string[]): string;
export function blankRole(): Role;
export function toolChoices(role: Role): string[];
export function TeamView(p: { ws: WorkspaceSnapshot; roles: Role[]; onRolesChanged(): void; onOpenAgent(id: string): void; onError(m: string): void }): JSX.Element;
export function RoleEditor(p: { role: Role; isNew: boolean; skills: Skill[]; onSaved(role: Role): void; onSkillsChanged(): void; onError(m: string): void }): JSX.Element;
```

- [ ] **Step 1: Write the failing test** — `src/renderer/src/team/roleForm.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { KNOWN_TOOLS, blankRole, roleIdFromName, toggle, toolChoices } from './roleForm';

describe('role form helpers', () => {
  it('toggles list items', () => {
    expect(toggle(['Read'], 'Edit')).toEqual(['Read', 'Edit']);
    expect(toggle(['Read', 'Edit'], 'Read')).toEqual(['Edit']);
  });

  it('derives a safe, unique role id from a name', () => {
    expect(roleIdFromName('Data Scientist', [])).toBe('data-scientist');
    expect(roleIdFromName('Data Scientist', ['data-scientist'])).toBe('data-scientist-2');
    expect(roleIdFromName('Data Scientist', ['data-scientist', 'data-scientist-2'])).toBe('data-scientist-3');
    expect(roleIdFromName('  ✨  ', [])).toBe('custom');
    expect(roleIdFromName('../../etc', [])).toBe('etc');
  });

  it('starts new roles with safe defaults', () => {
    const r = blankRole();
    expect(r).toMatchObject({ id: '', model: 'sonnet', permissionMode: 'acceptEdits', allowedTools: ['Read', 'Edit', 'Write', 'Grep', 'Glob'] });
    expect(r.look.shirt).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it('offers known tools plus any custom ones the role already has', () => {
    expect(toolChoices({ ...blankRole(), allowedTools: ['Read', 'Bash(npm test:*)'] })).toEqual([...KNOWN_TOOLS, 'Bash(npm test:*)']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/renderer/src/team`
Expected: FAIL.

- [ ] **Step 3: Write `src/renderer/src/team/roleForm.ts`**

```ts
import type { Role } from '../../../shared/types';

export const KNOWN_TOOLS = ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'NotebookEdit'];
export const MODELS = ['opus', 'sonnet', 'haiku'];

export function toggle(list: string[], item: string): string[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

export function roleIdFromName(name: string, taken: string[]): string {
  const base = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'custom';
  if (!taken.includes(base)) return base;
  for (let i = 2; ; i++) if (!taken.includes(`${base}-${i}`)) return `${base}-${i}`;
}

export function blankRole(): Role {
  return {
    id: '', name: '', blurb: '', systemPrompt: '', skills: ['git-hygiene'], model: 'sonnet', permissionMode: 'acceptEdits',
    allowedTools: ['Read', 'Edit', 'Write', 'Grep', 'Glob'], look: { hair: '#8A4B2A', shirt: '#3E8E5A', skin: '#F1C9A5' },
  };
}

export function toolChoices(role: Role): string[] {
  return [...KNOWN_TOOLS, ...role.allowedTools.filter((t) => !KNOWN_TOOLS.includes(t))];
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/renderer/src/team`
Expected: PASS.

- [ ] **Step 5: Write `src/renderer/src/components/RoleEditor.tsx`**

```tsx
import { useEffect, useState } from 'react';
import type { Role, Skill } from '../../../shared/types';
import { Avatar } from '../sprites/Avatar';
import { MODELS, roleIdFromName, toggle, toolChoices } from '../team/roleForm';

interface Props { role: Role; isNew: boolean; takenIds: string[]; skills: Skill[]; onSaved: (role: Role) => void; onSkillsChanged: () => void; onError: (m: string) => void }

export function RoleEditor({ role, isNew, takenIds, skills, onSaved, onSkillsChanged, onError }: Props) {
  const [draft, setDraft] = useState<Role>(role);
  const [hireName, setHireName] = useState('');
  const [newSkill, setNewSkill] = useState<{ name: string; description: string; body: string } | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setDraft(role); setSaved(false); }, [role]);
  const set = (patch: Partial<Role>) => { setDraft((d) => ({ ...d, ...patch })); setSaved(false); };

  const save = async () => {
    const toSave = isNew ? { ...draft, id: roleIdFromName(draft.name, takenIds) } : draft;
    try { const r = await window.agentOffice.saveRole(toSave); setSaved(true); onSaved(r); } catch (e) { onError(String(e)); }
  };
  const hire = async () => {
    try { await window.agentOffice.hire(draft.id, hireName.trim() || undefined); setHireName(''); } catch (e) { onError(String(e)); }
  };
  const addSkill = async () => {
    if (!newSkill) return;
    try {
      const s = await window.agentOffice.saveSkill({ id: roleIdFromName(newSkill.name, skills.map((x) => x.id)), ...newSkill });
      setNewSkill(null);
      onSkillsChanged();
      set({ skills: [...draft.skills, s.id] });
    } catch (e) { onError(String(e)); }
  };

  return (
    <section className="editor" aria-label="Role editor">
      <div className="row" style={{ gap: 14 }}>
        <Avatar look={draft.look} size={56} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="pixel" style={{ margin: 0, fontSize: 22, overflowWrap: 'anywhere' }}>{draft.name || 'New role'}</h2>
          <span className="small muted">Role template · used by every agent hired with it</span>
        </div>
        {(['hair', 'shirt', 'skin'] as const).map((k) => (
          <label key={k} className="field small" style={{ alignItems: 'center' }}>
            <span className="label">{k}</span>
            <input type="color" value={draft.look[k]} onChange={(e) => set({ look: { ...draft.look, [k]: e.target.value.toUpperCase() } })} style={{ width: 36, height: 28, padding: 0, border: 0, background: 'none' }} />
          </label>
        ))}
      </div>
      <div className="grid-2">
        <div className="field"><label htmlFor="re-name">Name</label><input id="re-name" className="input" value={draft.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} /></div>
        <div className="field"><label htmlFor="re-blurb">Short description</label><input id="re-blurb" className="input" value={draft.blurb} maxLength={120} onChange={(e) => set({ blurb: e.target.value })} /></div>
        <div className="field">
          <label htmlFor="re-model">Model</label>
          <select id="re-model" className="input" value={draft.model} onChange={(e) => set({ model: e.target.value })}>
            {[...new Set([...MODELS, draft.model])].map((m) => <option key={m}>{m}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="re-perm">Permission mode</label>
          <select id="re-perm" className="input" value={draft.permissionMode} onChange={(e) => set({ permissionMode: e.target.value as Role['permissionMode'] })}>
            <option value="acceptEdits">acceptEdits</option><option value="default">default</option><option value="plan">plan</option><option value="bypassPermissions">bypassPermissions</option>
          </select>
        </div>
      </div>
      {draft.permissionMode === 'bypassPermissions' && <p className="warn" role="note">bypassPermissions lets this role run any command without asking. Only use it for repos you can afford to lose.</p>}
      <div className="field">
        <span className="label">Allowed tools</span>
        <div className="row">
          {toolChoices(draft).map((t) => <button key={t} type="button" className="toggle" aria-pressed={draft.allowedTools.includes(t)} onClick={() => set({ allowedTools: toggle(draft.allowedTools, t) })}>{t}</button>)}
        </div>
      </div>
      <div className="field">
        <label htmlFor="re-prompt">System prompt</label>
        <textarea id="re-prompt" className="input mono" rows={6} value={draft.systemPrompt} onChange={(e) => set({ systemPrompt: e.target.value })} />
      </div>
      <div className="field">
        <div className="row"><span className="label">Skills</span><button type="button" className="btn small" style={{ marginLeft: 'auto' }} onClick={() => setNewSkill({ name: '', description: '', body: '' })}>Add skill file</button></div>
        {skills.map((s) => (
          <label key={s.id} className="skill-row">
            <input type="checkbox" checked={draft.skills.includes(s.id)} onChange={() => set({ skills: toggle(draft.skills, s.id) })} style={{ width: 18, height: 18, accentColor: 'var(--teal)' }} />
            <span className="mono">{s.id}.md</span>
            <span className="muted small" style={{ marginLeft: 'auto' }}>{s.description}</span>
          </label>
        ))}
        {newSkill && (
          <div className="panel-box">
            <div className="grid-2">
              <div className="field"><label htmlFor="ns-name">Skill name</label><input id="ns-name" className="input" value={newSkill.name} onChange={(e) => setNewSkill({ ...newSkill, name: e.target.value })} /></div>
              <div className="field"><label htmlFor="ns-desc">Description</label><input id="ns-desc" className="input" value={newSkill.description} onChange={(e) => setNewSkill({ ...newSkill, description: e.target.value })} /></div>
            </div>
            <div className="field"><label htmlFor="ns-body">Instructions (markdown)</label><textarea id="ns-body" className="input mono" rows={5} value={newSkill.body} onChange={(e) => setNewSkill({ ...newSkill, body: e.target.value })} /></div>
            <div className="row"><button type="button" className="btn teal small" onClick={() => void addSkill()}>Save skill</button><button type="button" className="btn small" onClick={() => setNewSkill(null)}>Cancel</button></div>
          </div>
        )}
      </div>
      <div className="row" style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }}>
        <button type="button" className="btn" onClick={() => void save()} disabled={!draft.name.trim()}>Save role</button>
        {saved && <span className="small ok">Saved</span>}
        {!isNew && draft.id !== 'boss' && (
          <div className="row" style={{ marginLeft: 'auto' }}>
            <label htmlFor="hire-name" className="sr-only">Name for the new hire (optional)</label>
            <input id="hire-name" className="input" placeholder="Name (optional)" value={hireName} maxLength={40} onChange={(e) => setHireName(e.target.value)} />
            <button type="button" className="btn primary" onClick={() => void hire()}>Hire {draft.name}</button>
          </div>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 6: Write `src/renderer/src/components/TeamView.tsx`**

```tsx
import { useEffect, useState } from 'react';
import type { Role, Skill, WorkspaceSnapshot } from '../../../shared/types';
import { Avatar } from '../sprites/Avatar';
import { STATUS_LABEL, lookFor } from '../sprites/sprite';
import { blankRole } from '../team/roleForm';
import { RoleEditor } from './RoleEditor';

interface Props { ws: WorkspaceSnapshot; roles: Role[]; onRolesChanged: () => void; onOpenAgent: (id: string) => void; onError: (m: string) => void }

export function TeamView({ ws, roles, onRolesChanged, onOpenAgent, onError }: Props) {
  const [selected, setSelected] = useState<string>('frontend');
  const [creating, setCreating] = useState(false);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [confirmFire, setConfirmFire] = useState<string | null>(null);
  const loadSkills = () => { window.agentOffice.listSkills().then(setSkills, () => setSkills([])); };
  useEffect(loadSkills, []);

  const library = roles.filter((r) => r.id !== 'boss');
  const current = creating ? null : roles.find((r) => r.id === selected) ?? library[0];
  const fire = async (id: string) => {
    try { await window.agentOffice.fireAgent(id); } catch (e) { onError(String(e)); } finally { setConfirmFire(null); }
  };

  return (
    <div className="team-layout">
      <div className="team-col">
        <section aria-label="Role library" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="row"><h2 style={{ margin: 0, fontSize: 16 }}>Role library</h2><span className="small muted">Pick a role to edit, then hire</span></div>
          <div className="role-grid">
            {library.map((r) => (
              <button key={r.id} type="button" className="role-card" aria-pressed={!creating && current?.id === r.id} onClick={() => { setCreating(false); setSelected(r.id); }}>
                <Avatar look={r.look} size={36} />
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <span style={{ fontWeight: 600 }}>{r.name}</span>
                  <span className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.blurb}</span>
                </span>
              </button>
            ))}
            <button type="button" className="role-card" aria-pressed={creating} onClick={() => setCreating(true)}>
              <span className="pixel" style={{ fontSize: 22, width: 36, textAlign: 'center' }} aria-hidden="true">+</span>
              <span style={{ fontWeight: 600 }}>New role</span>
            </button>
          </div>
        </section>
        <section aria-label="Current team" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>On the team <span className="muted" style={{ fontWeight: 400 }}>· {ws.agents.length}</span></h2>
          {ws.agents.map((a) => {
            const role = roles.find((r) => r.id === a.roleId);
            return (
              <div key={a.id} className="team-row">
                <Avatar look={lookFor(a, roles)} size={32} />
                <span style={{ fontWeight: 600 }}>{a.name}</span>
                <span className="small muted">{a.kind === 'boss' ? 'Boss' : role?.name ?? a.roleId}</span>
                <span className="mono small muted">{role?.model}</span>
                <span className="small muted">{STATUS_LABEL[a.status]}</span>
                <span className="row" style={{ marginLeft: 'auto' }}>
                  <button type="button" className="btn small" onClick={() => onOpenAgent(a.id)}>Open</button>
                  {a.kind === 'employee' && (confirmFire === a.id
                    ? <><button type="button" className="btn small danger" onClick={() => void fire(a.id)}>Confirm fire</button><button type="button" className="btn small" onClick={() => setConfirmFire(null)}>Keep</button></>
                    : <button type="button" className="btn small danger" onClick={() => setConfirmFire(a.id)}>Fire</button>)}
                </span>
              </div>
            );
          })}
        </section>
      </div>
      {creating ? (
        <RoleEditor role={blankRole()} isNew takenIds={roles.map((r) => r.id)} skills={skills} onSaved={(r) => { setCreating(false); setSelected(r.id); onRolesChanged(); }} onSkillsChanged={loadSkills} onError={onError} />
      ) : current ? (
        <RoleEditor role={current} isNew={false} takenIds={roles.map((r) => r.id)} skills={skills} onSaved={() => onRolesChanged()} onSkillsChanged={loadSkills} onError={onError} />
      ) : null}
    </div>
  );
}
```

In `App.tsx`, add the team case:
```tsx
      case 'team': return <TeamView ws={ws} roles={state.roles} onRolesChanged={refreshRoles} onOpenAgent={(id) => go({ name: 'agent', agentId: id })} onError={onError} />;
```

- [ ] **Step 7: Typecheck, test, build, look, commit**

Run: `npm run typecheck && npm test && npm run build`. In the dev app:
- Pick "QA Engineer", change the model, then Save and confirm the "Saved" note appears.
- Create a "New role" named "Data Scientist" and save it. It should appear in the library.
- Add a skill file and confirm it shows up checked.
- Hire from a role, then fire that agent (Fire → Confirm fire).

```bash
git add -A
git commit -m "feat(ui): team view with role library, role editor, skills, hire and fire

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Settings, first launch and the "Claude Code not found" screen

**Files:**
- Create: `src/renderer/src/components/SettingsView.tsx`, `src/renderer/src/components/NoClaude.tsx`
- Rewrite: `src/renderer/src/components/Onboarding.tsx`
- Modify: `src/renderer/src/App.tsx`, `src/main/index.ts` (status is recomputed on every `app:status` call)

**Interfaces:**
- Produces: `SettingsView({ ws, onStatus, onClosed, onError })`, `Onboarding({ status, onOpened })`, `NoClaude({ onFound })`.

- [ ] **Step 1: Recompute the CLI status on request** — in `src/main/index.ts`, replace the `IPC.appStatus` handler with:

```ts
  ipcMain.handle(IPC.appStatus, async () => {
    status.current = statusFor(await settings.get());
    if (status.current.claude) svc.configure({ claudeBin: status.current.claude.path });
    return status.current;
  });
```

- [ ] **Step 2: Write `src/renderer/src/components/NoClaude.tsx`**

```tsx
import { useState } from 'react';
import type { AppStatus } from '../../../shared/types';

export function NoClaude({ onFound }: { onFound: (s: AppStatus) => void }) {
  const [custom, setCustom] = useState('');
  const [note, setNote] = useState<string | null>(null);

  const check = async (saveCustom: boolean) => {
    if (saveCustom) await window.agentOffice.saveSettings({ claudePath: custom.trim() || null });
    const s = await window.agentOffice.getStatus();
    if (s.claude) onFound(s);
    else setNote(saveCustom && custom.trim() ? `No Claude Code binary at ${custom.trim()}.` : 'Still not found.');
  };

  return (
    <main className="boot" aria-labelledby="nc-title">
      <h1 id="nc-title" className="pixel">AgentOffice needs Claude Code</h1>
      <p>Your agents run on the Claude Code command-line tool, using your own Claude sign-in. It isn't installed on this computer, or AgentOffice can't find it.</p>
      <ol>
        <li>Install Claude Code by following the guide at <span className="mono">docs.claude.com/en/docs/claude-code</span>.</li>
        <li>Open a terminal, run <code>claude</code> once and sign in.</li>
        <li>Come back here and press <strong>Check again</strong>.</li>
      </ol>
      <div className="row"><button type="button" className="btn primary" onClick={() => void check(false)}>Check again</button></div>
      <form className="field" style={{ marginTop: 24 }} onSubmit={(e) => { e.preventDefault(); void check(true); }}>
        <label htmlFor="nc-path">Installed somewhere unusual? Path to the <code>claude</code> program</label>
        <div className="row">
          <input id="nc-path" className="input mono" style={{ flex: 1, minWidth: 240 }} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="/usr/local/bin/claude" />
          <button type="submit" className="btn">Use this path</button>
        </div>
      </form>
      {note && <p className="bad" role="alert">{note}</p>}
    </main>
  );
}
```

- [ ] **Step 3: Rewrite `src/renderer/src/components/Onboarding.tsx`** (from the design's First launch screen)

```tsx
import { useEffect, useState } from 'react';
import type { AppStatus, Project, WorkspaceSnapshot } from '../../../shared/types';
import { DeskSprite } from '../sprites/DeskSprite';
import { MODELS } from '../team/roleForm';

const BOSS_LOOK = { hair: '#3B2A20', shirt: '#2B3350', skin: '#E8B48A' };
const clean = (m: string) => m.replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '');

export function Onboarding({ status, onOpened }: { status: AppStatus; onOpened: (ws: WorkspaceSnapshot) => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [folder, setFolder] = useState('');
  const [bossName, setBossName] = useState('Max');
  const [bossModel, setBossModel] = useState('opus');
  const [canHire, setCanHire] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { window.agentOffice.listProjects().then(setProjects, () => setProjects([])); }, []);

  const open = async (repoPath: string, fresh: boolean) => {
    setBusy(true);
    setError(null);
    try {
      onOpened(await window.agentOffice.openProject(repoPath, fresh ? { bossName: bossName.trim() || 'Max', bossModel, bossCanHire: canHire } : undefined));
    } catch (e) {
      setError(clean(String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="onboarding-wrap">
      <div className="onboarding-card">
        <div className="onboarding-art">
          <DeskSprite name={bossName.trim() || 'Max'} role="Boss" look={BOSS_LOOK} status="waiting" bubble="Ready when you are" />
          <div className="pixel" style={{ fontSize: 26, color: '#f2efe6' }}>Your office is empty.</div>
          <div className="small" style={{ color: '#e0d2c6', maxWidth: 260 }}>Hire a boss, point it at a repo, and it will build the rest of the team.</div>
        </div>
        <form className="onboarding-form" onSubmit={(e) => { e.preventDefault(); if (folder.trim()) void open(folder.trim(), true); }}>
          <div>
            <h1 className="pixel" style={{ margin: '0 0 6px', fontSize: 30 }}>Welcome to AgentOffice</h1>
            <p className="muted" style={{ margin: 0 }}>Three steps. Agents run on your local Claude Code, so you don't need an API key.</p>
          </div>
          <div className="step">
            <span className="step-badge done" aria-hidden="true">✓</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>Claude Code found</div>
              <div className="mono small muted" style={{ overflowWrap: 'anywhere' }}>{status.claude?.path}{status.claude?.version ? ` · v${status.claude.version}` : ''}</div>
            </div>
          </div>
          <div className="step">
            <span className="step-badge active" aria-hidden="true">2</span>
            <div className="field" style={{ flex: 1, minWidth: 0 }}>
              <label htmlFor="ob-folder" style={{ fontWeight: 600, color: 'var(--text)', fontSize: 14 }}>Project folder</label>
              <div className="row">
                <input id="ob-folder" className="input mono" style={{ flex: 1, minWidth: 0 }} value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="Pick a git repository" />
                <button type="button" className="btn" onClick={async () => { const p = await window.agentOffice.pickFolder(); if (p) setFolder(p); }}>Browse</button>
              </div>
              <span className="small muted">Must be a git repo with at least one commit. Each agent gets its own worktree in .agentoffice/wt/</span>
            </div>
          </div>
          <div className="step">
            <span className="step-badge" aria-hidden="true">3</span>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontWeight: 600 }}>Hire your boss</span>
              <div className="grid-2">
                <div className="field"><label htmlFor="ob-name">Name</label><input id="ob-name" className="input" value={bossName} maxLength={40} onChange={(e) => setBossName(e.target.value)} /></div>
                <div className="field"><label htmlFor="ob-model">Model</label><select id="ob-model" className="input" value={bossModel} onChange={(e) => setBossModel(e.target.value)}>{MODELS.map((m) => <option key={m}>{m}</option>)}</select></div>
              </div>
              <label className="row small"><input type="checkbox" checked={canHire} onChange={(e) => setCanHire(e.target.checked)} style={{ width: 18, height: 18, accentColor: 'var(--teal)' }} /> Let the boss hire employees on its own</label>
            </div>
          </div>
          {error && <p className="bad" role="alert" style={{ margin: 0 }}>{error}</p>}
          <button type="submit" className="btn primary" style={{ alignSelf: 'flex-end' }} disabled={busy || !folder.trim()}>{busy ? 'Opening…' : 'Open the office →'}</button>
          {projects.length > 0 && (
            <section aria-label="Recent projects" style={{ borderTop: '1px solid var(--line)', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <h2 style={{ margin: 0, fontSize: 14 }} className="muted">Recent projects</h2>
              {projects.map((p) => (
                <button key={p.id} type="button" className="side-item" disabled={busy} onClick={() => void open(p.repoPath, false)}>
                  <strong>{p.name}</strong><span className="mono small muted side-label">{p.repoPath}</span>
                </button>
              ))}
            </section>
          )}
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write `src/renderer/src/components/SettingsView.tsx`**

```tsx
import { useEffect, useState } from 'react';
import type { AppSettings, AppStatus, WorkspaceSnapshot } from '../../../shared/types';

interface Props { ws: WorkspaceSnapshot; onStatus: (s: AppStatus) => void; onClosed: () => void; onError: (m: string) => void }

export function SettingsView({ ws, onStatus, onClosed, onError }: Props) {
  const [max, setMax] = useState(String(ws.project.maxConcurrent));
  const [autoMerge, setAutoMerge] = useState(ws.project.autoMerge);
  const [canHire, setCanHire] = useState(ws.project.bossCanHire);
  const [app, setApp] = useState<AppSettings | null>(null);
  const [claudePath, setClaudePath] = useState('');
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => { window.agentOffice.getSettings().then((s) => { setApp(s); setClaudePath(s.claudePath ?? ''); }, () => undefined); }, []);

  const saveProject = async () => {
    try {
      await window.agentOffice.updateProject({ maxConcurrent: Number(max), autoMerge, bossCanHire: canHire });
      setNote('Project settings saved.');
    } catch (e) { onError(String(e)); }
  };
  const saveApp = async () => {
    if (!app) return;
    try {
      await window.agentOffice.saveSettings({ claudePath: claudePath.trim() || null, isolateUserSettings: app.isolateUserSettings });
      const s = await window.agentOffice.getStatus();
      onStatus(s);
      setNote(s.claude ? `Using Claude Code at ${s.claude.path}. Applies to sessions started from now on.` : 'Claude Code was not found at that path.');
    } catch (e) { onError(String(e)); }
  };
  const close = async () => {
    try { await window.agentOffice.closeProject(); onClosed(); } catch (e) { onError(String(e)); }
  };

  return (
    <div className="settings">
      {note && <p className="ok" role="status">{note}</p>}
      <section className="panel-box" aria-labelledby="set-project">
        <h2 id="set-project" style={{ margin: 0, fontSize: 16 }}>This project</h2>
        <div className="field">
          <label htmlFor="set-max">Agents working at the same time (1–8)</label>
          <input id="set-max" className="input" type="number" min={1} max={8} value={max} onChange={(e) => setMax(e.target.value)} style={{ maxWidth: 120 }} />
        </div>
        <label className="row"><input type="checkbox" checked={autoMerge} onChange={(e) => setAutoMerge(e.target.checked)} style={{ width: 18, height: 18 }} /> Merge finished work without asking me</label>
        <label className="row"><input type="checkbox" checked={canHire} onChange={(e) => setCanHire(e.target.checked)} style={{ width: 18, height: 18 }} /> Let the boss hire employees on its own</label>
        <div className="row"><button type="button" className="btn primary" onClick={() => void saveProject()}>Save project settings</button></div>
      </section>
      <section className="panel-box" aria-labelledby="set-app">
        <h2 id="set-app" style={{ margin: 0, fontSize: 16 }}>App</h2>
        <div className="field">
          <label htmlFor="set-claude">Path to Claude Code (leave empty to detect it)</label>
          <input id="set-claude" className="input mono" value={claudePath} onChange={(e) => setClaudePath(e.target.value)} placeholder="Detected automatically" />
        </div>
        {app && (
          <label className="row">
            <input type="checkbox" checked={app.isolateUserSettings} onChange={(e) => setApp({ ...app, isolateUserSettings: e.target.checked })} style={{ width: 18, height: 18 }} />
            Keep my personal Claude Code hooks and plugins out of agent sessions (recommended)
          </label>
        )}
        <div className="row"><button type="button" className="btn" onClick={() => void saveApp()}>Save app settings</button></div>
      </section>
      <section className="panel-box" aria-labelledby="set-close">
        <h2 id="set-close" style={{ margin: 0, fontSize: 16 }}>Close project</h2>
        <p className="small muted" style={{ margin: 0 }}>Stops every agent in this project. Running tasks pick up again when you reopen it.</p>
        <div className="row"><button type="button" className="btn danger" onClick={() => void close()}>Close {ws.project.name}</button></div>
      </section>
    </div>
  );
}
```

- [ ] **Step 5: Wire them into `App.tsx`**

- Replace the not-found block with `if (!status.claude) return <NoClaude onFound={setStatus} />;`.
- Replace the onboarding line with `if (!ws) return <Onboarding status={status} onOpened={(snap) => dispatch({ type: 'snapshot', ws: snap })} />;`.
- Add the settings case: `case 'settings': return <SettingsView ws={ws} onStatus={setStatus} onClosed={() => dispatch({ type: 'closed' })} onError={onError} />;`.
- Remove the interim `default:` notice now that every view exists. TypeScript checks the switch is exhaustive.

- [ ] **Step 6: Typecheck, test, build, look**

Run: `npm run typecheck && npm test && npm run build`.
In the dev app, check each of these:
- the first-launch screen;
- opening a scratch repo with the boss named "Ada";
- in Settings, setting max concurrent to 9 shows an error banner, and 2 saves;
- Close project returns you to first launch;
- starting with `AO_CLAUDE_MISSING=1` shows the not-found screen.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(ui): first-launch flow, settings view and Claude-not-found screen

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Polish from the Plan 2 review (deferred minors)

**Files:**
- Modify: `src/main/agents/agentManager.ts`, `src/main/boss/bossSession.ts`, `src/main/git/worktrees.ts`, `src/main/workspace/projectService.ts`, `src/main/mcp/mcpHost.ts`, `src/main/index.ts`
- Create: `src/main/ipcGuard.ts`
- Test: `test/polish.test.ts`, `src/main/ipcGuard.test.ts`, additions to `test/merge.test.ts`

**Interfaces:**
- Produces: `export class UserError extends Error` (agentManager.ts) — expected mistakes (unknown names or tasks, duplicates, busy, closed) that `run()` does **not** broadcast as `{ type: 'error' }`; `isTrustedSender(url: string | undefined, devUrl: string | undefined): boolean`.

- [ ] **Step 1: Write the failing tests**

`test/polish.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { BossSession } from '../src/main/boss/bossSession';
import { ClaudeRunner } from '../src/main/claude/runner';
import type { ChatEntry } from '../src/shared/types';
import { harness, waitFor, type Harness } from './helpers/manager';

let h: Harness;
beforeEach(async () => { h = await harness(); });
afterEach(async () => { await h.cleanup(); });

describe('polish', () => {
  it('does not broadcast expected mistakes as app errors', async () => {
    const { manager } = await h.make();
    const errors: string[] = [];
    manager.on('event', (e) => { if (e.type === 'error') errors.push(e.message); });
    await expect(manager.createTask({ assignee: 'Nobody', title: 't', brief: 'b', createdBy: 'boss' })).rejects.toThrow(/No employee named/);
    await expect(manager.hire('nope')).rejects.toThrow(/Unknown role/);
    await manager.idle();
    expect(errors).toEqual([]);
  });

  it('says the boss could not start instead of "stopped (null)"', async () => {
    const env = await h.make();
    await env.manager.createBoss('Max');
    const chat: ChatEntry[] = [];
    const boss = new BossSession({
      project: env.project, manager: env.manager, roles: env.roles, skills: env.skills, store: env.store,
      createRunner: (o) => new ClaudeRunner({ ...o, bin: path.join(h.data, 'no-such-claude') }),
      claudeBin: 'claude', promptDir: h.paths.promptDir, mcpConfigPath: path.join(h.data, 'mcp.json'), isolateUserSettings: true,
    });
    boss.on('chat', (e) => chat.push(e));
    boss.start();
    await boss.send('hi');
    const deadline = Date.now() + 10_000;
    while (!chat.some((e) => e.kind === 'error') && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    expect(chat.find((e) => e.kind === 'error')).toMatchObject({ text: expect.stringContaining('could not start') });
    await boss.stop();
  });

  it('words a failed employee reply as a failure', async () => {
    const env = await h.make();
    await env.manager.createBoss('Max');
    const chat: ChatEntry[] = [];
    const boss = new BossSession({
      project: env.project, manager: env.manager, roles: env.roles, skills: env.skills, store: env.store,
      createRunner: (o) => new ClaudeRunner({ ...o, bin: process.execPath, binArgs: [path.resolve('test/fake-claude/fake-claude.mjs')], env: { ...process.env, ...h.fakeEnv } }),
      claudeBin: 'claude', promptDir: h.paths.promptDir, mcpConfigPath: path.join(h.data, 'mcp.json'), isolateUserSettings: true,
    });
    boss.on('chat', (e) => chat.push(e));
    boss.start();
    const pixel = await env.manager.hire('frontend');
    env.manager.emit('event', { type: 'agent-replied', agent: pixel, text: 'simulated failure', ok: false });
    await waitFor(env.manager, () => chat.some((e) => e.kind === 'event'), 5000).catch(() => undefined);
    expect(chat.find((e) => e.kind === 'event')).toMatchObject({ text: 'Pixel could not answer: simulated failure' });
    await boss.stop();
  });
});
```

`src/main/ipcGuard.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { isTrustedSender } from './ipcGuard';

describe('isTrustedSender', () => {
  it('accepts the packaged app page and the dev server only', () => {
    expect(isTrustedSender('file:///Applications/AgentOffice.app/Contents/Resources/app.asar/out/renderer/index.html', undefined)).toBe(true);
    expect(isTrustedSender('http://localhost:5173/', 'http://localhost:5173')).toBe(true);
    expect(isTrustedSender('http://localhost:5173/', undefined)).toBe(false);
    expect(isTrustedSender('https://evil.example/', 'http://localhost:5173')).toBe(false);
    expect(isTrustedSender(undefined, undefined)).toBe(false);
  });
});
```

Add to `test/merge.test.ts`:
```ts
  it('explains a detached checkout', async () => {
    await workOn('ao/pixel/a', 'hello.txt', 'hi\n');
    await git(repo, ['checkout', '-q', '--detach']);
    expect(await wm.merge('main', 'ao/pixel/a', 'Merge')).toMatchObject({ status: 'blocked', reason: expect.stringMatching(/not on a branch/) });
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run test/polish.test.ts src/main/ipcGuard.test.ts test/merge.test.ts`
Expected: FAIL on each new test.

- [ ] **Step 3: Implement**

`src/main/agents/agentManager.ts`:
```ts
/** A mistake in the request (unknown name, duplicate, busy…), not an app failure. */
export class UserError extends Error {}
```
Throw `UserError` (instead of `Error`) for:
- No employee named …
- Unknown task …
- Unknown role …
- An agent named … already exists
- … is too similar to …
- … has not worked on anything yet
- This project is closed
- The boss cannot be fired
- … is working right now
- … still has open work
- … is just finishing up
- Task … is not running

In `run()`, change the chain line to:
```ts
    this.chain = result.then(() => undefined, (e) => { if (!(e instanceof UserError)) this.emitEvent({ type: 'error', message: msg(e) }); });
```

`src/main/boss/bossSession.ts`:
- In `start()`, change the `agent-replied` notify text to `e.ok ? `${e.agent.name} replied: ${e.text}` : `${e.agent.name} could not answer: ${e.text}``.
- In the exit branch, word a spawn failure clearly: `const why = ev.code === null && ev.signal === null ? 'could not start' : `stopped (${ev.code ?? ev.signal})`;` and use `The boss session ${why}. It will restart with your next message.`.
- Make the status update fire-and-forget so chat never waits behind git work: `void this.d.manager.setLive(bossId, ev).catch(() => undefined);`.

`src/main/git/worktrees.ts` `merge()`: before the `head !== base` check, add
```ts
    if (head === 'HEAD') return { status: 'blocked', reason: `The project folder is not on a branch (detached HEAD). Check out ${base} to merge.` };
```

`src/main/ipcGuard.ts`:
```ts
/** IPC is only accepted from the app's own page: the packaged file, or the dev server in development. */
export function isTrustedSender(url: string | undefined, devUrl: string | undefined): boolean {
  if (!url) return false;
  if (url.startsWith('file://')) return true;
  return Boolean(devUrl) && url.startsWith(devUrl as string);
}
```
In `src/main/index.ts`, wrap `ipcMain.handle` once at the top of `registerIpc` and use the wrapper for every channel:
```ts
  const handle = (channel: string, fn: (...args: unknown[]) => unknown) =>
    ipcMain.handle(channel, (e, ...args) => {
      if (!isTrustedSender(e.senderFrame?.url, process.env.ELECTRON_RENDERER_URL)) throw new Error('Untrusted sender');
      return fn(...args);
    });
```
(handlers drop their leading `_e` parameter accordingly).

`src/main/workspace/projectService.ts` `open()`: wrap everything after `await host.start()` in `try { … } catch (err) { await host.close(); await manager.shutdown(); throw err; }` so a failed open never leaves a listening MCP server behind.

`src/main/mcp/mcpHost.ts` `writeConfig`: add the comment `// mode 0o600 is ignored on Windows; the file lives in the user's private app-data folder and the token changes on every open.`

- [ ] **Step 4: Run tests**

Run: `npm test && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix: quieter expected errors, clearer boss messages, IPC sender guard, detached-HEAD merges

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Packaging and release builds for macOS, Windows and Linux

**Files:**
- Create: `scripts/make-icon.mjs`, `scripts/make-icon.d.mts`, `build/icon.png` (generated), `electron-builder.yml`, `.github/workflows/release.yml`
- Modify: `package.json`, `.github/workflows/ci.yml`, `README.md`, `.gitignore` (add `release/`, already present)
- Test: `test/icon.test.ts`

- [ ] **Step 1: Write the failing test** — `test/icon.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { makeIcon } from '../scripts/make-icon.mjs';

describe('makeIcon', () => {
  it('produces a square 1024px PNG', () => {
    const png = makeIcon();
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
    expect(png.readUInt32BE(16)).toBe(1024);
    expect(png.readUInt32BE(20)).toBe(1024);
    expect(png.subarray(-8, -4).toString('ascii')).toBe('IEND');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/icon.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the icon generator**

`scripts/make-icon.mjs`:
```js
// Draws the AgentOffice pixel logo into a PNG with no image libraries (used by electron-builder).
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const LOGO = [
  [0, 0, 10, 10, '#F5B942'], [1, 1, 5, 4, '#14151F'], [2, 2, 3, 1, '#52D1BE'], [3, 5, 1, 1, '#14151F'],
  [1, 6, 8, 1, '#8B5A34'], [1, 7, 1, 2, '#8B5A34'], [8, 7, 1, 2, '#8B5A34'], [7, 2, 2, 2, '#14151F'], [7, 4, 2, 2, '#2F9E8F'],
];

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export function makeIcon(size = 1024) {
  const cell = Math.floor(size / 12); // 1-cell transparent margin around the 10x10 logo
  const offset = Math.floor((size - cell * 10) / 2);
  const px = Buffer.alloc(size * size * 4);
  for (const [x, y, w, h, hex] of LOGO) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    for (let yy = offset + y * cell; yy < offset + (y + h) * cell; yy++) {
      for (let xx = offset + x * cell; xx < offset + (x + w) * cell; xx++) {
        const i = (yy * size + xx) * 4;
        px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
      }
    }
  }
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) px.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const out = path.resolve('build/icon.png');
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, makeIcon());
  console.log(`wrote ${out}`);
}
```

`scripts/make-icon.d.mts`:
```ts
export function makeIcon(size?: number): Buffer;
```

- [ ] **Step 4: Run it to verify it passes, then generate the icon**

Run: `npx vitest run test/icon.test.ts && node scripts/make-icon.mjs`
Expected: PASS; `build/icon.png` written. Look at it with the image viewer to confirm the logo.

- [ ] **Step 5: Configure electron-builder**

Run: `npm install -D electron-builder`

`electron-builder.yml`:
```yaml
appId: com.leoanimesh.agentoffice
productName: AgentOffice
directories:
  output: release
  buildResources: build
files:
  - out/**
  - package.json
extraResources:
  - from: resources
    to: resources
mac:
  target: [dmg]
  category: public.app-category.developer-tools
win:
  target: [nsis]
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
linux:
  target: [AppImage, deb]
  category: Development
  maintainer: leoAnimesh <mondalarup808@gmail.com>
publish: null
```

`package.json`: add `"homepage": "https://github.com/leoAnimesh/agent-office"` and the scripts `"icon": "node scripts/make-icon.mjs"`, `"dist": "npm run build && electron-builder --publish never"`, `"pack": "npm run build && electron-builder --dir --publish never"`.

- [ ] **Step 6: Build a real installer locally**

Run: `CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist 2>&1 | tail -15 && ls release/`
Expected: `release/AgentOffice-0.1.0-arm64.dmg` (or x64) exists. Mount it, launch the app, and confirm it starts, finds Claude Code, and shows the first-launch screen with the pixel fonts. That last check proves `resources/` and the fonts are packaged.

- [ ] **Step 7: Release workflow** — `.github/workflows/release.yml`

```yaml
name: Release
on:
  push:
    tags: ['v*']
  workflow_dispatch:
permissions:
  contents: write
jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        os: [macos-latest, windows-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run dist
        env:
          CSC_IDENTITY_AUTO_DISCOVERY: 'false'
      - uses: actions/upload-artifact@v4
        with:
          name: agentoffice-${{ matrix.os }}
          if-no-files-found: error
          path: |
            release/*.dmg
            release/*.exe
            release/*.AppImage
            release/*.deb
  release:
    needs: build
    if: startsWith(github.ref, 'refs/tags/')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with:
          path: dist
          merge-multiple: true
      - uses: softprops/action-gh-release@v2
        with:
          draft: true
          files: dist/*
```

In `.github/workflows/ci.yml`, add a final step so every PR proves packaging works on all three OSes: `- run: npx electron-builder --dir --publish never` with `env: { CSC_IDENTITY_AUTO_DISCOVERY: 'false' }`.

- [ ] **Step 8: README install section** — add after the intro:

```markdown
## Install
Download the latest build for your OS from [Releases](https://github.com/leoAnimesh/agent-office/releases):
- **macOS:** `AgentOffice-x.y.z.dmg`. The app is not notarized yet. After dragging it to Applications, right-click it and choose **Open** the first time.
- **Windows:** `AgentOffice Setup x.y.z.exe`. If SmartScreen warns, choose **More info → Run anyway**.
- **Linux:** `AgentOffice-x.y.z.AppImage` (`chmod +x` it, then run it) or the `.deb` package.

You also need [Claude Code](https://docs.claude.com/en/docs/claude-code) installed and signed in. AgentOffice uses your own Claude account.
```
and, under "Develop", document the environment overrides:
```markdown
Test-only environment variables: `AO_USER_DATA` (app data folder), `AO_CLAUDE_BIN` + `AO_CLAUDE_ARGS` (use a stand-in CLI such as `node test/fake-claude/fake-claude.mjs`), `AO_CLAUDE_MISSING=1` (pretend Claude Code is not installed), `AO_E2E_PICK_FOLDER` (folder the picker returns).
```

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "build: icon, electron-builder config, release workflow and install docs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: End-to-end smoke test of the real app

**Files:**
- Create: `playwright.config.ts`, `e2e/smoke.spec.ts`
- Modify: `package.json`, `tsconfig.json` (include `e2e/**/*.ts`, `playwright.config.ts`), `.github/workflows/ci.yml`

- [ ] **Step 1: Install Playwright's test runner** (Electron needs no browser download)

Run: `npm install -D @playwright/test`

`playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({ testDir: 'e2e', timeout: 90_000, workers: 1, reporter: 'list' });
```

- [ ] **Step 2: Write the smoke test** — `e2e/smoke.spec.ts`

```ts
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeRepo } from '../test/helpers/repo';

const FAKE = path.resolve('test/fake-claude/fake-claude.mjs');

async function launch(env: Record<string, string>): Promise<{ app: ElectronApplication; userData: string }> {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-e2e-'));
  const base = { ...process.env } as Record<string, string>;
  delete base.ELECTRON_RENDERER_URL;
  const args = process.platform === 'linux' ? ['--no-sandbox', path.resolve('.')] : [path.resolve('.')];
  const app = await electron.launch({ args, env: { ...base, AO_USER_DATA: userData, ...env } });
  return { app, userData };
}

test('first launch → open a repo → chat with the boss → hire → see the desk', async () => {
  const repo = await makeRepo();
  const { app, userData } = await launch({ AO_CLAUDE_BIN: process.execPath, AO_CLAUDE_ARGS: JSON.stringify([FAKE]), AO_E2E_PICK_FOLDER: repo });
  try {
    const win = await app.firstWindow();
    await expect(win.getByRole('heading', { name: 'Welcome to AgentOffice' })).toBeVisible();
    await win.getByRole('button', { name: 'Browse' }).click();
    await win.getByRole('button', { name: /Open the office/ }).click();
    await expect(win.getByRole('button', { name: /^Max, Boss/ })).toBeVisible();

    const box = win.getByLabel('Message the boss');
    await box.fill('Hello <b>team</b> 🤖 '.repeat(3).trim());
    await box.press('Enter');
    await expect(win.getByText(/^echo: Hello <b>team<\/b> 🤖/)).toBeVisible();

    await win.getByRole('navigation', { name: 'Project views' }).getByRole('button', { name: 'Team' }).click();
    await win.getByRole('button', { name: /^Frontend Engineer/ }).click();
    await win.getByRole('button', { name: 'Hire Frontend Engineer' }).click();
    await win.getByRole('navigation', { name: 'Project views' }).getByRole('button', { name: 'Office' }).click();
    await expect(win.getByRole('button', { name: /^Pixel, Frontend Engineer/ })).toBeVisible();
  } finally {
    await app.close();
    await fs.rm(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    await fs.rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('explains what to do when Claude Code is not installed', async () => {
  const { app, userData } = await launch({ AO_CLAUDE_MISSING: '1' });
  try {
    const win = await app.firstWindow();
    await expect(win.getByRole('heading', { name: 'AgentOffice needs Claude Code' })).toBeVisible();
    await expect(win.getByRole('button', { name: 'Check again' })).toBeVisible();
  } finally {
    await app.close();
    await fs.rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
```

- [ ] **Step 3: Run it**

Run: `npm run build && npx playwright test`
Expected: 2 passed. If a locator is ambiguous, tighten it with a role or name in the test. Never weaken an assertion.

- [ ] **Step 4: Scripts and CI**

`package.json` script: `"test:e2e": "npm run build && playwright test"`. Add `"e2e/**/*.ts"` and `"playwright.config.ts"` to `tsconfig.json` `include`. In `.github/workflows/ci.yml`, after the build step:
```yaml
      - run: npx playwright test
        if: runner.os != 'Linux'
      - run: xvfb-run -a npx playwright test
        if: runner.os == 'Linux'
```

- [ ] **Step 5: Commit, push, PR, CI**

```bash
git add -A
git commit -m "test: Playwright end-to-end smoke test of the packaged app flow

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin HEAD
```
Open a draft PR and get CI green on all three OSes (unit, E2E, packaging).

---

## Spec coverage (Plan 3)

| Spec section | Covered by |
|---|---|
| §8 Office view (pixel floor, boss corner office, whiteboard, desks, bubbles, animations, empty desk) | Tasks 2, 4 |
| §8 Agent detail (metadata, skills, actions, live log, current task, changes) | Tasks 1, 5 |
| §8 Task board (columns, filter, new task → boss) | Task 6 |
| §8 Team & roles (library, team, hire/fire, role editor, skills) | Tasks 1, 7 |
| §8 Settings (CLI path, concurrency, auto-merge, boss hiring, isolation) | Tasks 1, 3, 8 |
| §8 First launch (detect CLI, pick repo, hire boss) | Task 8 |
| §9 missing CLI screen, renderer hardening, IPC sender guard | Tasks 8, 9 |
| §9a packaging: dmg / nsis / AppImage+deb, release workflow on all three OSes | Task 10 |
| §10 Playwright + Electron smoke test in CI | Task 11 |
| Plan 2 deferred minors | Task 9 (crashing-boss backoff stays deferred) |
