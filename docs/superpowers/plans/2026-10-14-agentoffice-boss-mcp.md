# AgentOffice Boss + MCP — Implementation Plan (Plan 2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The user opens a git repo in the app, chats with a Boss agent (a real `claude` session), and the Boss hires employees, assigns tasks, follows results and asks for merges through MCP tools hosted by the app.

**Architecture:** An `McpHost` (Streamable HTTP, 127.0.0.1, bearer token) exposes `bossTools` built on the Plan 1 `AgentManager`. `BossSession` runs the Boss as a long-lived `ClaudeRunner` with `--mcp-config`, read-only built-in tools (`--tools Read Grep Glob`) and `--allowedTools mcp__agentoffice`. It turns the Boss's output into chat entries and feeds task results back into the Boss's stdin. `ProjectService` ties one open project together, and the app talks to it through typed IPC. A plain workspace UI (team, tasks, chat, merge approvals) makes it usable. Plan 3 replaces that UI with the pixel office.

**Tech Stack:** Plan 1 stack + `@modelcontextprotocol/sdk` 1.32 (server + client for tests) + `zod` 4.

**Spec:** `docs/superpowers/specs/2026-10-14-agentoffice-design.md` (§5 Boss, §6 MCP tools, §8 chat parts, §9)

**Verified on the real CLI (2.1.299) before planning:**
- `--mcp-config` with `{"type":"http","url":…,"headers":{"Authorization":"Bearer …"}}` connects; tools are named `mcp__agentoffice__<tool>`. `--allowedTools mcp__agentoffice` auto-approves every tool on that server.
- `--tools Read Grep Glob` limits built-ins to exactly those; MCP tools stay available; `Write` is not even offered.
- The SDK's `StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })` with a fresh `McpServer` per request works with the CLI.

## Global Constraints

- Everything from Plan 1's Global Constraints still applies (cross-platform, args arrays, `node:path`, CI matrix green, commit trailer).
- The MCP server binds to `127.0.0.1` only and rejects requests without the exact bearer token (constant-time compare). The config file holding the token is written with mode `0o600`.
- The Boss never gets file-editing tools: `--tools` is the Boss role's `allowedTools` (Read, Grep, Glob).
- Merges never happen without the user's OK unless `project.autoMerge` is true (default false). Approval is asynchronous: `request_merge` returns at once and the Boss is told the outcome later.
- Logging and chat persistence are best-effort; they never block state changes.
- Renderer: no `nodeIntegration`; new windows denied; navigation away from the app page blocked.

## Review Focus

1. **Boss process dies or exits** (crash, logout, killed) → the chat shows a clear error and the next user message restarts the Boss with `--resume`. Test: Task 5.
2. **Merge when the user's checkout is not ready** (on another branch, uncommitted changes, conflicts) → nothing is lost, the main checkout is left clean, and the Boss is told why. Test: Task 2 and Task 6.
3. **Unauthorized or malformed MCP requests** (no token, wrong token, wrong path, bad JSON, huge body) → rejected without crashing the host. Test: Task 4.
4. **Bad tool input from the model** (missing fields, unknown agent or task, hiring when it's off) → a tool error the Boss can read, never an exception that kills the session. Test: Task 3.
5. **Opening a folder that isn't a git repo, or reopening the same project** → a clear error, or the same project with its history. Test: Task 6.

---

## File Structure

```
src/shared/types.ts                 + ChatEntry, WorkspaceSnapshot, WorkspaceEvent, MergeRequest
src/shared/ipc.ts                   + all workspace channels and the AgentOfficeApi
src/main/claude/args.ts             + `tools` launch option
src/main/git/worktrees.ts           + merge(), identityArgs()
src/main/store/projectStore.ts      + appendChat(), readChat()
src/main/agents/agentManager.ts     + getTask, messageAgent, merge, setSessionId, setLive, 'agent-replied'
src/main/agents/prompt.ts           + boss "How you work" section
src/main/agents/bossTools.ts        tool definitions (zod-validated) over AgentManager
src/main/mcp/mcpHost.ts             HTTP MCP server for the Boss
src/main/boss/bossSession.ts        the Boss's claude session ↔ chat
src/main/workspace/approvalBroker.ts pending merge approvals
src/main/workspace/projectService.ts open/close a project, wire everything, emit WorkspaceEvents
src/main/index.ts                   IPC handlers, event forwarding, navigation guards, clean quit
src/preload/index.ts                full API
src/renderer/src/state.ts           reducer for snapshot + events
src/renderer/src/App.tsx            status → onboarding → workspace
src/renderer/src/components/{Onboarding,Workspace,TeamPanel,TaskBoard,BossChat}.tsx
src/renderer/src/workspace.css
test/helpers/manager.ts             shared AgentManager harness for new tests
test/fake-claude/fake-claude.mjs    (unchanged)
test/*.test.ts                      integration tests
test/real/boss.real.test.ts         opt-in end-to-end with the real CLI (AO_REAL_CLAUDE=1)
```

---

### Task 1: `tools` launch option and boss prompt rules

**Files:**
- Modify: `src/main/claude/args.ts`, `src/main/agents/prompt.ts`
- Test: `src/main/claude/args.test.ts`, `src/main/agents/prompt.test.ts`

**Interfaces:**
- Produces: `ClaudeLaunch.tools?: string[]` → `--tools <names…>` (`[]` → `--tools ""`, meaning no built-ins). `renderPrompt(role, skills, { kind: 'boss', … })` now includes a `## How you work` section.

- [ ] **Step 1: Write the failing tests**

Append to `src/main/claude/args.test.ts` inside `describe('buildClaudeArgs')`:
```ts
  it('limits built-in tools with --tools, keeping both variadic flags last', () => {
    const args = buildClaudeArgs({ tools: ['Read', 'Grep'], allowedTools: ['mcp__agentoffice'] });
    expect(args.slice(-5)).toEqual(['--tools', 'Read', 'Grep', '--allowedTools', 'mcp__agentoffice']);
    expect(buildClaudeArgs({ tools: [] }).slice(-2)).toEqual(['--tools', '']);
  });
```

Append to `src/main/agents/prompt.test.ts` inside `describe('renderPrompt')`:
```ts
  it('gives the boss delegation rules and no worktree rules', () => {
    const out = renderPrompt({ ...role, name: 'Boss', systemPrompt: 'Lead.' }, [], { agentName: 'Max', bossName: 'Max', branch: 'main', projectName: 'demo', kind: 'boss' });
    expect(out).toContain('You are Max, the boss of the "demo" team in AgentOffice.');
    expect(out).toContain('## How you work');
    expect(out).toContain('assign_task');
    expect(out).not.toContain('## Rules');
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/main/claude/args.test.ts src/main/agents/prompt.test.ts`
Expected: the two new tests FAIL (`--tools` missing; no `## How you work`).

- [ ] **Step 3: Implement**

In `src/main/claude/args.ts` add to `ClaudeLaunch`:
```ts
  /** Restrict the built-in tools to exactly these (MCP tools stay available). */
  tools?: string[];
```
and in `buildClaudeArgs`, just before the `allowedTools` line:
```ts
  if (l.tools) a.push('--tools', ...(l.tools.length > 0 ? l.tools : ['']));
```

In `src/main/agents/prompt.ts`, after the skills block, add:
```ts
  if (ctx.kind === 'boss') {
    parts.push(
      [
        '## How you work',
        '- You cannot edit files. Delegate all implementation to employees with `assign_task`.',
        '- Start by calling `list_team` and `list_roles`. If nobody fits, `hire` someone (if hiring is allowed).',
        '- Keep tasks small and independent. Use `depends_on` when a task needs another task merged first.',
        '- Messages that start with [AgentOffice] come from the app, not the user. When a task finishes, read it with `get_task`, then `request_merge` if it is good or `message_agent` with precise feedback if not.',
        '- Use `report_to_user` for short progress updates. Keep chat replies brief.',
      ].join('\n'),
    );
  }
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/main/claude src/main/agents && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(boss): --tools launch option and boss delegation rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Merging a task branch safely

**Files:**
- Modify: `src/main/git/worktrees.ts`
- Test: `test/merge.test.ts`

**Interfaces:**
- Produces:
```ts
export type MergeResult =
  | { status: 'merged'; commit: string }
  | { status: 'conflict'; files: string[] }
  | { status: 'blocked'; reason: string };
WorktreeManager.merge(base: string, branch: string, message: string): Promise<MergeResult>
export function identityArgs(cwd: string): Promise<string[]>
```

- [ ] **Step 1: Write the failing test** — `test/merge.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { WorktreeManager, git } from '../src/main/git/worktrees';
import { makeRepo } from './helpers/repo';

let repo: string;
let wm: WorktreeManager;
beforeEach(async () => { repo = await makeRepo(); wm = new WorktreeManager(repo); });
afterEach(async () => { await fs.rm(repo, { recursive: true, force: true }); });

async function workOn(branch: string, file: string, content: string): Promise<void> {
  const wt = await wm.prepare('Pixel', branch, 'main');
  await fs.writeFile(path.join(wt, file), content);
  await wm.commitAll(wt, `work on ${file}`);
}

describe('WorktreeManager.merge', () => {
  it('merges a task branch into the base branch with a merge commit', async () => {
    await workOn('ao/pixel/a', 'hello.txt', 'hi\n');
    const r = await wm.merge('main', 'ao/pixel/a', 'Merge T-101: hello');
    expect(r.status).toBe('merged');
    expect(await fs.readFile(path.join(repo, 'hello.txt'), 'utf8')).toBe('hi\n');
    expect(await git(repo, ['log', '-1', '--format=%s'])).toBe('Merge T-101: hello');
  });

  it('reports conflicts, aborts, and leaves the checkout clean', async () => {
    await workOn('ao/pixel/a', 'README.md', 'from pixel\n');
    await fs.writeFile(path.join(repo, 'README.md'), 'from main\n');
    await git(repo, ['commit', '-qam', 'main edit']);
    const r = await wm.merge('main', 'ao/pixel/a', 'Merge');
    expect(r).toEqual({ status: 'conflict', files: ['README.md'] });
    expect(await git(repo, ['status', '--porcelain'])).toBe('');
    expect(await fs.readFile(path.join(repo, 'README.md'), 'utf8')).toBe('from main\n');
  });

  it('refuses when the checkout has uncommitted changes', async () => {
    await workOn('ao/pixel/a', 'hello.txt', 'hi\n');
    await fs.writeFile(path.join(repo, 'scratch.txt'), 'mine');
    const r = await wm.merge('main', 'ao/pixel/a', 'Merge');
    expect(r).toMatchObject({ status: 'blocked', reason: expect.stringMatching(/uncommitted changes/) });
    expect(existsSync(path.join(repo, 'hello.txt'))).toBe(false);
  });

  it('refuses when the checkout is on another branch', async () => {
    await workOn('ao/pixel/a', 'hello.txt', 'hi\n');
    await git(repo, ['checkout', '-qb', 'feature']);
    const r = await wm.merge('main', 'ao/pixel/a', 'Merge');
    expect(r).toMatchObject({ status: 'blocked', reason: expect.stringMatching(/on branch feature/) });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/merge.test.ts`
Expected: FAIL — `wm.merge is not a function`.

- [ ] **Step 3: Implement** in `src/main/git/worktrees.ts`

Add above the class:
```ts
export type MergeResult =
  | { status: 'merged'; commit: string }
  | { status: 'conflict'; files: string[] }
  | { status: 'blocked'; reason: string };

/** Use the user's git identity; fall back to an AgentOffice one so commits never fail. */
export async function identityArgs(cwd: string): Promise<string[]> {
  const has = await git(cwd, ['config', 'user.email']).then(Boolean, () => false);
  return has ? [] : ['-c', 'user.name=AgentOffice', '-c', 'user.email=agentoffice@localhost'];
}
```
Replace the identity lines in `commitAll` with:
```ts
    await git(worktree, [...(await identityArgs(worktree)), 'commit', '-q', '-m', message]);
```
Add to the class:
```ts
  async merge(base: string, branch: string, message: string): Promise<MergeResult> {
    await this.ensureExcluded();
    const head = await git(this.repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (head !== base) {
      return { status: 'blocked', reason: `The project folder is on branch ${head}. Switch it back to ${base} to merge.` };
    }
    if (await git(this.repoRoot, ['status', '--porcelain'])) {
      return { status: 'blocked', reason: 'The project folder has uncommitted changes. Commit or stash them, then ask again.' };
    }
    try {
      await git(this.repoRoot, [...(await identityArgs(this.repoRoot)), 'merge', '--no-ff', '-m', message, branch]);
      return { status: 'merged', commit: await git(this.repoRoot, ['rev-parse', 'HEAD']) };
    } catch (err) {
      const files = (await git(this.repoRoot, ['diff', '--name-only', '--diff-filter=U']).catch(() => '')).split(/\r?\n/).filter(Boolean);
      await git(this.repoRoot, ['merge', '--abort']).catch(() => undefined);
      if (files.length > 0) return { status: 'conflict', files };
      throw err;
    }
  }
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/merge.test.ts test/worktrees.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(git): merge task branches with conflict and dirty-checkout protection

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: AgentManager additions and Boss tools

**Files:**
- Modify: `src/main/agents/agentManager.ts`, `src/shared/types.ts`
- Create: `src/main/agents/bossTools.ts`, `test/helpers/manager.ts`
- Test: `test/agentManager.boss.test.ts`, `test/bossTools.test.ts`

**Interfaces:**
- Consumes: `WorktreeManager.merge`, `MergeResult` (Task 2); `reduceStatus` (Plan 1).
- Produces:
```ts
// AgentManager
getTask(id: string): Task | undefined;
messageAgent(ref: string, text: string): Promise<'sent' | 'started'>;
merge(taskId: string): Promise<MergeOutcome>;
setSessionId(agentId: string, sessionId: string): Promise<void>;
setLive(agentId: string, ev: RunnerEvent): Promise<void>;
export type MergeOutcome = MergeResult | { status: 'not_ready'; reason: string };
// new ManagerEvent member
| { type: 'agent-replied'; agent: Agent; text: string; ok: boolean }

// bossTools.ts
export interface ToolDef { name: string; description: string; input: z.ZodRawShape; run(args: unknown): Promise<unknown> }
export interface BossToolDeps {
  manager: AgentManager; roles: RoleStore; project: Project;
  requestMerge(task: Task): Promise<unknown>;
  report(text: string): void;
}
export function bossTools(d: BossToolDeps): ToolDef[];
// test/helpers/manager.ts
export interface Harness { repo: string; data: string; argvOut: string; fakeEnv: Record<string, string>; paths: DataPaths;
  make(opts?: { maxConcurrent?: number; autoMerge?: boolean }): Promise<{ manager: AgentManager; project: Project; roles: RoleStore; skills: SkillStore; store: ProjectStore }>;
  launches(): Promise<{ argv: string[]; cwd: string }[]>; cleanup(): Promise<void> }
export function harness(): Promise<Harness>;
export function waitFor(m: { on(e: 'event', l: (e: ManagerEvent) => void): unknown; off(e: 'event', l: (e: ManagerEvent) => void): unknown }, pred: (e: ManagerEvent) => boolean, ms?: number): Promise<ManagerEvent>;
export function finished(m: AgentManager, taskId: string): Promise<ManagerEvent>;
```

- [ ] **Step 1: Write the shared test harness** — `test/helpers/manager.ts`

```ts
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentManager, type ManagerEvent } from '../../src/main/agents/agentManager';
import { ClaudeRunner } from '../../src/main/claude/runner';
import { WorktreeManager } from '../../src/main/git/worktrees';
import { dataPaths, type DataPaths } from '../../src/main/store/paths';
import { ProjectStore } from '../../src/main/store/projectStore';
import { RoleStore } from '../../src/main/store/roleStore';
import { SkillStore } from '../../src/main/store/skillStore';
import type { Project } from '../../src/shared/types';
import { makeRepo } from './repo';
import { FAKE_CLAUDE } from './runner';

export interface Harness {
  repo: string;
  data: string;
  argvOut: string;
  fakeEnv: Record<string, string>;
  paths: DataPaths;
  make(opts?: { maxConcurrent?: number; autoMerge?: boolean }): Promise<{ manager: AgentManager; project: Project; roles: RoleStore; skills: SkillStore; store: ProjectStore }>;
  launches(): Promise<{ argv: string[]; cwd: string }[]>;
  cleanup(): Promise<void>;
}

export async function harness(): Promise<Harness> {
  const repo = await makeRepo();
  const data = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-h-'));
  const argvOut = path.join(data, 'argv.jsonl');
  const fakeEnv: Record<string, string> = { FAKE_CLAUDE_ARGV_OUT: argvOut, FAKE_CLAUDE_FILE: 'notes.txt' };
  const paths = dataPaths(data);
  const managers: AgentManager[] = [];
  return {
    repo, data, argvOut, fakeEnv, paths,
    async make(opts = {}) {
      const roles = new RoleStore(paths.rolesDir);
      const skills = new SkillStore(paths.skillsDir);
      const store = new ProjectStore(paths);
      await roles.seed(path.resolve('resources/roles'));
      await skills.seed(path.resolve('resources/skills'));
      const project: Project = { id: 'p1', name: 'demo', repoPath: repo, baseBranch: 'main', maxConcurrent: opts.maxConcurrent ?? 4, bossCanHire: true, autoMerge: opts.autoMerge ?? false };
      const manager = new AgentManager({
        project, store, roles, skills, worktrees: new WorktreeManager(repo),
        createRunner: (o) => new ClaudeRunner({ ...o, bin: process.execPath, binArgs: [FAKE_CLAUDE], env: { ...process.env, ...fakeEnv } }),
        claudeBin: 'claude', promptDir: paths.promptDir, isolateUserSettings: true,
      });
      await manager.load();
      managers.push(manager);
      return { manager, project, roles, skills, store };
    },
    async launches() {
      const raw = await fs.readFile(argvOut, 'utf8').catch(() => '');
      return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l) as { argv: string[]; cwd: string });
    },
    async cleanup() {
      for (const m of managers) await m.shutdown();
      await fs.rm(repo, { recursive: true, force: true });
      await fs.rm(data, { recursive: true, force: true });
    },
  };
}

type Emitter = { on(e: 'event', l: (e: ManagerEvent) => void): unknown; off(e: 'event', l: (e: ManagerEvent) => void): unknown };

export function waitFor(m: Emitter, pred: (e: ManagerEvent) => boolean, ms = 20000): Promise<ManagerEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { m.off('event', l); reject(new Error('timed out waiting for manager event')); }, ms);
    const l = (e: ManagerEvent) => { if (pred(e)) { clearTimeout(timer); m.off('event', l); resolve(e); } };
    m.on('event', l);
  });
}

export const finished = (m: AgentManager, id: string) => waitFor(m, (e) => e.type === 'task-finished' && e.task.id === id);
```

- [ ] **Step 2: Write the failing tests**

`test/agentManager.boss.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { finished, harness, waitFor, type Harness } from './helpers/manager';

let h: Harness;
beforeEach(async () => { h = await harness(); });
afterEach(async () => { await h.cleanup(); });

describe('AgentManager (boss support)', () => {
  it('messages an idle agent by resuming its session and reports the reply', async () => {
    const { manager } = await h.make();
    await manager.hire('frontend');
    const exited = waitFor(manager, (e) => e.type === 'agent-event' && e.event.type === 'exit');
    await manager.createTask({ assignee: 'Pixel', title: 'a', brief: 'a', createdBy: 'boss' });
    await exited;
    await manager.idle();
    const replied = waitFor(manager, (e) => e.type === 'agent-replied');
    expect(await manager.messageAgent('pixel', 'Please also add a test')).toBe('started');
    const r = await replied;
    expect(r).toMatchObject({ type: 'agent-replied', text: 'echo: Please also add a test', ok: true });
    const last = (await h.launches()).at(-1)!;
    expect(last.argv).toContain('--resume');
  });

  it('refuses to message an agent that never worked', async () => {
    const { manager } = await h.make();
    await manager.hire('frontend');
    await expect(manager.messageAgent('Pixel', 'hi')).rejects.toThrow(/has not worked on anything yet/);
    await expect(manager.messageAgent('Nobody', 'hi')).rejects.toThrow(/No employee named Nobody/);
  });

  it('merges a reviewed task, marks it done and starts its dependents', async () => {
    const { manager } = await h.make();
    await manager.hire('frontend');
    await manager.hire('qa', 'Quinn');
    const done = finished(manager, 'T-101');
    await manager.createTask({ assignee: 'Pixel', title: 'build', brief: 'x', createdBy: 'boss' });
    await manager.createTask({ assignee: 'Quinn', title: 'test', brief: 'y', dependsOn: ['T-101'], createdBy: 'boss' });
    await done;
    await manager.idle();
    const second = finished(manager, 'T-102');
    expect(await manager.merge('T-101')).toMatchObject({ status: 'merged' });
    expect(manager.getTask('T-101')!.status).toBe('done');
    expect(await fs.readFile(path.join(h.repo, 'notes.txt'), 'utf8')).toContain('turn 1');
    await second;
  });

  it('will not merge a task that is not in review', async () => {
    const { manager } = await h.make();
    await manager.hire('frontend');
    h.fakeEnv.FAKE_CLAUDE_HANG = '1';
    const started = waitFor(manager, (e) => e.type === 'agent-event' && e.event.type === 'init');
    await manager.createTask({ assignee: 'Pixel', title: 'a', brief: 'a', createdBy: 'boss' });
    await started;
    expect(await manager.merge('T-101')).toMatchObject({ status: 'not_ready' });
  });

  it('tracks the boss session id and live status', async () => {
    const { manager } = await h.make();
    const boss = await manager.createBoss('Max');
    await manager.setSessionId(boss.id, 'sess-boss');
    await manager.setLive(boss.id, { type: 'tool_use', id: '1', name: 'mcp__agentoffice__assign_task', input: { agent: 'Pixel' } });
    expect(manager.findAgent('Max')).toMatchObject({ sessionId: 'sess-boss', status: 'working', bubble: 'Assigning Pixel' });
  });
});
```

`test/bossTools.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bossTools, type ToolDef } from '../src/main/agents/bossTools';
import { finished, harness, type Harness } from './helpers/manager';

let h: Harness;
beforeEach(async () => { h = await harness(); });
afterEach(async () => { await h.cleanup(); });

const call = (tools: ToolDef[], name: string, args: unknown = {}) => tools.find((t) => t.name === name)!.run(args);

async function setup(over: { bossCanHire?: boolean } = {}) {
  const env = await h.make();
  const project = { ...env.project, ...over };
  const requestMerge = vi.fn(async () => ({ status: 'awaiting_user_approval' }));
  const report = vi.fn();
  const tools = bossTools({ manager: env.manager, roles: env.roles, project, requestMerge, report });
  return { ...env, tools, requestMerge, report };
}

describe('bossTools', () => {
  it('exposes the documented tool set', async () => {
    const { tools } = await setup();
    expect(tools.map((t) => t.name).sort()).toEqual(['assign_task', 'cancel_task', 'get_task', 'hire', 'list_roles', 'list_tasks', 'list_team', 'message_agent', 'report_to_user', 'request_merge']);
    for (const t of tools) expect(t.description.length).toBeGreaterThan(10);
  });

  it('lists roles without the boss role', async () => {
    const { tools } = await setup();
    const roles = (await call(tools, 'list_roles')) as { id: string }[];
    expect(roles.map((r) => r.id)).toContain('frontend');
    expect(roles.map((r) => r.id)).not.toContain('boss');
  });

  it('hires, lists the team, assigns, and reads back a finished task', async () => {
    const { tools, manager } = await setup();
    expect(await call(tools, 'hire', { role_id: 'frontend' })).toEqual({ name: 'Pixel', role: 'Frontend Engineer' });
    expect(await call(tools, 'list_team')).toEqual([{ name: 'Pixel', role: 'Frontend Engineer', status: 'idle', doing: 'Idle', current_task: null }]);
    const done = finished(manager, 'T-101');
    expect(await call(tools, 'assign_task', { agent: 'Pixel', title: 'Add toggle', brief: 'Make it' })).toMatchObject({ task_id: 'T-101', status: expect.any(String) });
    await done;
    const t = (await call(tools, 'get_task', { task_id: 'T-101' })) as Record<string, unknown>;
    expect(t).toMatchObject({ id: 'T-101', assignee: 'Pixel', status: 'review', files_changed: [{ path: 'notes.txt', add: 1, del: 0 }] });
    expect(String(t.result_summary)).toContain('Make it');
    expect(await call(tools, 'list_tasks', { status: 'review' })).toHaveLength(1);
  });

  it('refuses to hire when hiring is turned off', async () => {
    const { tools } = await setup({ bossCanHire: false });
    await expect(call(tools, 'hire', { role_id: 'frontend' })).rejects.toThrow(/Hiring is turned off/);
  });

  it('validates input from the model', async () => {
    const { tools } = await setup();
    await expect(call(tools, 'assign_task', { agent: 'Pixel' })).rejects.toThrow();
    await expect(call(tools, 'get_task', { task_id: 'T-999' })).rejects.toThrow(/Unknown task T-999/);
    await expect(call(tools, 'list_tasks', { status: 'sleeping' })).rejects.toThrow();
  });

  it('routes merge requests and reports through the deps', async () => {
    const { tools, manager, requestMerge, report } = await setup();
    await call(tools, 'hire', { role_id: 'frontend' });
    const done = finished(manager, 'T-101');
    await call(tools, 'assign_task', { agent: 'Pixel', title: 'a', brief: 'b' });
    await done;
    expect(await call(tools, 'request_merge', { task_id: 'T-101' })).toEqual({ status: 'awaiting_user_approval' });
    expect(requestMerge).toHaveBeenCalledWith(expect.objectContaining({ id: 'T-101' }));
    expect(await call(tools, 'report_to_user', { text: 'Halfway there' })).toEqual({ ok: true });
    expect(report).toHaveBeenCalledWith('Halfway there');
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run test/agentManager.boss.test.ts test/bossTools.test.ts`
Expected: FAIL — missing methods / module.

- [ ] **Step 4: Install zod and the MCP SDK**

Run: `npm install zod @modelcontextprotocol/sdk`
Expected: installs cleanly.

- [ ] **Step 5: Extend `AgentManager`** (`src/main/agents/agentManager.ts`)

1. Imports: add `import { git, type MergeResult } from '../git/worktrees';` (keep `WorktreeManager, slugify`) and `import type { Role } from '../../shared/types';` is already covered by adding `Role` to the existing type import.
2. Types:
```ts
export type MergeOutcome = MergeResult | { status: 'not_ready'; reason: string };
```
Add to `ManagerEvent`:
```ts
  | { type: 'agent-replied'; agent: Agent; text: string; ok: boolean }
```
Change `interface Live { runner: AgentRunner; taskId: string }` to `taskId: string | null`.
3. Extract the prompt writing from `startTask` into a helper and use it there:
```ts
  private async writePrompt(agent: Agent, role: Role, branch: string): Promise<string> {
    const boss = this.agentList.find((a) => a.kind === 'boss');
    const skills = await this.d.skills.getMany(role.skills);
    const promptFile = path.join(this.d.promptDir, `${agent.id}.md`);
    await fs.mkdir(this.d.promptDir, { recursive: true });
    await fs.writeFile(promptFile, renderPrompt(role, skills, {
      agentName: agent.name, bossName: boss?.name ?? 'the boss', branch, projectName: this.d.project.name, kind: 'employee',
    }));
    return promptFile;
  }
```
In `startTask`, replace the `boss`/`skills`/`promptFile`/`writeFile` lines with `const promptFile = await this.writePrompt(agent, role, task.branch);`, and pull the runner creation into a helper used by both `startTask` and `messageAgent`:
```ts
  private spawn(agent: Agent, role: Role, cwd: string, promptFile: string, taskId: string | null): AgentRunner {
    const runner = this.d.createRunner({
      bin: this.d.claudeBin,
      cwd,
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
    this.live.set(agent.id, { runner, taskId });
    // Errors are already reported as { type: 'error' } by run(); swallow here to avoid unhandled rejections.
    runner.on('event', (ev) => { this.run(() => this.onRunnerEvent(agent.id, taskId, runner, ev)).catch(() => undefined); });
    return runner;
  }
```
`startTask` then reads:
```ts
    const runner = this.spawn(agent, role, wt, promptFile, task.id);
    const message = taskMessage(task);
    this.setStatus(task, 'working', { attempts: task.attempts + 1 });
    await this.saveTasks();
    runner.start();
    if (runner.running) runner.send(message);
```
4. `onRunnerEvent(agentId: string, taskId: string | null, runner, ev)`: look the task up with `const task = taskId ? this.taskList.find((t) => t.id === taskId) : undefined;` and change the `result` branch to:
```ts
    if (ev.type === 'result') {
      runner.endInput();
      if (task?.status === 'working') await this.finishTask(agent, task, ev.ok, ev.text);
      else if (taskId === null) this.emitEvent({ type: 'agent-replied', agent: { ...agent }, text: ev.text, ok: ev.ok });
    }
```
5. New public methods:
```ts
  getTask(id: string): Task | undefined {
    const t = this.taskList.find((x) => x.id === id);
    return t ? { ...t } : undefined;
  }

  messageAgent(ref: string, text: string): Promise<'sent' | 'started'> {
    return this.run(async () => {
      const agent = this.findAgent(ref);
      if (!agent || agent.kind !== 'employee') throw new Error(`No employee named ${ref}`);
      const live = this.live.get(agent.id);
      if (live?.runner.running) {
        live.runner.send(text);
        return 'sent';
      }
      if (!agent.sessionId || !agent.worktreePath) throw new Error(`${agent.name} has not worked on anything yet. Assign a task instead.`);
      const role = await this.d.roles.get(agent.roleId);
      if (!role) throw new Error(`Role ${agent.roleId} is missing`);
      const branch = await git(agent.worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD']);
      const promptFile = await this.writePrompt(agent, role, branch);
      const runner = this.spawn(agent, role, agent.worktreePath, promptFile, null);
      agent.status = 'thinking';
      agent.bubble = 'Reading a message…';
      runner.start();
      if (runner.running) runner.send(text);
      return 'started';
    });
  }

  async merge(taskId: string): Promise<MergeOutcome> {
    const outcome = await this.run(async (): Promise<MergeOutcome> => {
      const t = this.mustTask(taskId);
      if (t.status !== 'review') return { status: 'not_ready', reason: `Task ${taskId} is ${t.status}, not waiting for review.` };
      const r = await this.d.worktrees.merge(this.d.project.baseBranch, t.branch, `Merge ${t.id}: ${t.title}`);
      if (r.status === 'merged') {
        this.setStatus(t, 'done');
        await this.saveTasks();
      }
      return r;
    });
    if (outcome.status === 'merged') await this.pump();
    return outcome;
  }

  setSessionId(agentId: string, sessionId: string): Promise<void> {
    return this.run(async () => {
      const a = this.mustAgent(agentId);
      if (a.sessionId === sessionId) return;
      a.sessionId = sessionId;
      await this.saveAgents();
    });
  }

  /** Live status for agents whose runner lives outside the manager (the boss). */
  setLive(agentId: string, ev: RunnerEvent): Promise<void> {
    return this.run(async () => {
      const a = this.mustAgent(agentId);
      Object.assign(a, reduceStatus(a, ev));
      this.emitEvent({ type: 'agents-changed' });
    });
  }
```

- [ ] **Step 6: Write `src/main/agents/bossTools.ts`**

```ts
import { z } from 'zod';
import type { Project, Task } from '../../shared/types';
import type { RoleStore } from '../store/roleStore';
import type { AgentManager } from './agentManager';

export interface ToolDef {
  name: string;
  description: string;
  input: z.ZodRawShape;
  run(args: unknown): Promise<unknown>;
}

export interface BossToolDeps {
  manager: AgentManager;
  roles: RoleStore;
  project: Project;
  /** Merge now (auto-merge) or ask the user; returns what the boss should be told. */
  requestMerge(task: Task): Promise<unknown>;
  report(text: string): void;
}

function tool<S extends z.ZodRawShape>(name: string, description: string, input: S, run: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>): ToolDef {
  const schema = z.object(input);
  return { name, description, input, run: async (args) => run(schema.parse(args ?? {})) };
}

const STATUSES = ['queued', 'working', 'needs_help', 'review', 'done', 'failed', 'cancelled'] as const;

export function bossTools(d: BossToolDeps): ToolDef[] {
  const { manager } = d;
  const nameOf = (id: string) => manager.findAgent(id)?.name ?? 'unknown';
  const mustTask = (id: string): Task => {
    const t = manager.getTask(id);
    if (!t) throw new Error(`Unknown task ${id}`);
    return t;
  };
  const view = (t: Task, full = false) => ({
    id: t.id,
    title: t.title,
    assignee: nameOf(t.assigneeId),
    status: t.status,
    branch: t.branch,
    depends_on: t.dependsOn,
    ...(full ? { brief: t.brief, result_summary: t.resultSummary ?? null, files_changed: t.diffStat ?? [] } : {}),
  });

  return [
    tool('list_team', 'List your employees with their role, live status and current task.', {}, async () => {
      const roles = new Map((await d.roles.list()).map((r) => [r.id, r.name]));
      const tasks = manager.tasks();
      return manager.agents()
        .filter((a) => a.kind === 'employee')
        .map((a) => ({
          name: a.name,
          role: roles.get(a.roleId) ?? a.roleId,
          status: a.status,
          doing: a.bubble,
          current_task: tasks.find((t) => t.assigneeId === a.id && t.status === 'working')?.id ?? null,
        }));
    }),

    tool('list_roles', 'List the role templates you can hire from.', {}, async () =>
      (await d.roles.list()).filter((r) => r.id !== 'boss').map((r) => ({ id: r.id, name: r.name, blurb: r.blurb })),
    ),

    tool('hire', 'Hire a new employee from a role template. Optionally give them a name.', { role_id: z.string(), name: z.string().optional() }, async ({ role_id, name }) => {
      if (!d.project.bossCanHire) throw new Error('Hiring is turned off for this project. Ask the user to hire someone.');
      const a = await manager.hire(role_id, name);
      const role = await d.roles.get(a.roleId);
      return { name: a.name, role: role?.name ?? a.roleId };
    }),

    tool(
      'assign_task',
      'Give an employee a task. They work on their own git branch and you are told when they finish. Use depends_on for tasks that need other tasks merged first.',
      { agent: z.string(), title: z.string().min(1), brief: z.string().min(1), depends_on: z.array(z.string()).optional() },
      async ({ agent, title, brief, depends_on }) => {
        const t = await manager.createTask({ assignee: agent, title, brief, dependsOn: depends_on, createdBy: 'boss' });
        const now = manager.getTask(t.id) ?? t;
        return { task_id: now.id, branch: now.branch, status: now.status };
      },
    ),

    tool('get_task', 'Read a task, including its result summary and changed files.', { task_id: z.string() }, async ({ task_id }) => view(mustTask(task_id), true)),

    tool('list_tasks', 'List tasks, optionally filtered by status.', { status: z.enum(STATUSES).optional() }, async ({ status }) =>
      manager.tasks().filter((t) => !status || t.status === status).map((t) => view(t)),
    ),

    tool('message_agent', 'Send a follow-up message to an employee (feedback, a question, a change request).', { agent: z.string(), text: z.string().min(1) }, async ({ agent, text }) => ({
      delivered: await manager.messageAgent(agent, text),
    })),

    tool('request_merge', "Ask to merge a reviewed task's branch into the main branch. The user may need to approve; you will get a message with the outcome.", { task_id: z.string() }, async ({ task_id }) =>
      d.requestMerge(mustTask(task_id)),
    ),

    tool('cancel_task', 'Cancel a task that is no longer needed.', { task_id: z.string() }, async ({ task_id }) => {
      mustTask(task_id);
      await manager.cancelTask(task_id);
      return { status: 'cancelled' };
    }),

    tool('report_to_user', 'Post a short, highlighted progress update for the user.', { text: z.string().min(1) }, async ({ text }) => {
      d.report(text);
      return { ok: true };
    }),
  ];
}
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run test/agentManager.boss.test.ts test/bossTools.test.ts test/agentManager.test.ts && npm run typecheck`
Expected: PASS. The `list_team` test expects the agent's `status: 'idle'` and `doing: 'Idle'` right after hiring.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(boss): boss tool set over AgentManager (message, merge, live status)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: MCP host

**Files:**
- Create: `src/main/mcp/mcpHost.ts`
- Test: `test/mcpHost.test.ts`

**Interfaces:**
- Consumes: `ToolDef` (Task 3).
- Produces: `class McpHost(tools: ToolDef[], name = 'agentoffice') { readonly token: string; get url(): string; start(): Promise<void>; mcpConfig(): object; writeConfig(file: string): Promise<void>; close(): Promise<void> }`.

- [ ] **Step 1: Write the failing test** — `test/mcpHost.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpHost } from '../src/main/mcp/mcpHost';
import type { ToolDef } from '../src/main/agents/bossTools';

const tools: ToolDef[] = [
  { name: 'echo', description: 'Echo the text back', input: { text: z.string() }, run: async (a) => ({ said: (a as { text: string }).text }) },
  { name: 'boom', description: 'Always fails loudly', input: {}, run: async () => { throw new Error('nope, not allowed'); } },
];

let host: McpHost;
beforeEach(async () => { host = new McpHost(tools); await host.start(); });
afterEach(async () => { await host.close(); });

async function connect(token = host.token): Promise<Client> {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(host.url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return client;
}

describe('McpHost', () => {
  it('listens on loopback only', () => {
    expect(host.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  });

  it('lists and calls tools for an authorized client', async () => {
    const client = await connect();
    const list = await client.listTools();
    expect(list.tools.map((t) => t.name).sort()).toEqual(['boom', 'echo']);
    const r = await client.callTool({ name: 'echo', arguments: { text: 'hi' } });
    expect(r.isError).toBeFalsy();
    expect(JSON.parse((r.content as { text: string }[])[0].text)).toEqual({ said: 'hi' });
    await client.close();
  });

  it('turns thrown errors into tool errors the model can read', async () => {
    const client = await connect();
    const r = await client.callTool({ name: 'boom', arguments: {} });
    expect(r.isError).toBe(true);
    expect((r.content as { text: string }[])[0].text).toContain('nope, not allowed');
    await client.close();
  });

  it('rejects missing or wrong tokens, wrong paths, bad JSON and huge bodies', async () => {
    const post = (url: string, headers: Record<string, string>, body: string) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body });
    const ok = { authorization: `Bearer ${host.token}` };
    expect((await post(host.url, {}, '{}')).status).toBe(401);
    expect((await post(host.url, { authorization: 'Bearer wrong' }, '{}')).status).toBe(401);
    expect((await post(host.url.replace('/mcp', '/other'), ok, '{}')).status).toBe(404);
    expect((await post(host.url, ok, '{not json')).status).toBe(400);
    expect((await post(host.url, ok, 'x'.repeat(2 * 1024 * 1024))).status).toBe(413);
    await expect(connect('wrong')).rejects.toThrow();
  });

  it('writes a private claude --mcp-config file', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-mcp-'));
    const file = path.join(dir, 'mcp.json');
    await host.writeConfig(file);
    const cfg = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(cfg).toEqual({ mcpServers: { agentoffice: { type: 'http', url: host.url, headers: { Authorization: `Bearer ${host.token}` } } } });
    if (process.platform !== 'win32') expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/mcpHost.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/main/mcp/mcpHost.ts`**

```ts
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { ToolDef } from '../agents/bossTools';

const MAX_BODY = 1024 * 1024;

class HttpError extends Error {
  constructor(readonly status: number) { super(String(status)); }
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413);
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400);
  }
}

export class McpHost {
  readonly token = randomBytes(24).toString('hex');
  private server: http.Server | null = null;
  private port = 0;

  constructor(private readonly tools: ToolDef[], private readonly name = 'agentoffice') {}

  get url(): string {
    return `http://127.0.0.1:${this.port}/mcp`;
  }

  async start(): Promise<void> {
    const server = http.createServer((req, res) => { void this.handle(req, res); });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    this.port = (server.address() as AddressInfo).port;
    this.server = server;
  }

  mcpConfig(): { mcpServers: Record<string, { type: 'http'; url: string; headers: Record<string, string> }> } {
    return { mcpServers: { [this.name]: { type: 'http', url: this.url, headers: { Authorization: `Bearer ${this.token}` } } } };
  }

  async writeConfig(file: string): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(this.mcpConfig(), null, 2), { mode: 0o600 });
    await fs.chmod(file, 0o600).catch(() => undefined);
  }

  async close(): Promise<void> {
    const s = this.server;
    this.server = null;
    if (!s) return;
    s.closeAllConnections();
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }

  private authorized(header: string | undefined): boolean {
    const expected = Buffer.from(`Bearer ${this.token}`);
    const got = Buffer.from(header ?? '');
    return got.length === expected.length && timingSafeEqual(got, expected);
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/mcp') throw new HttpError(404);
      if (!this.authorized(req.headers.authorization)) throw new HttpError(401);
      if (Number(req.headers['content-length'] ?? 0) > MAX_BODY) throw new HttpError(413);
      const body = await readJsonBody(req);
      const mcp = this.buildServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => { void transport.close(); void mcp.close(); });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      req.resume(); // drain whatever is left so the client receives the status instead of a reset
      if (!res.headersSent) res.writeHead(err instanceof HttpError ? err.status : 500, { connection: 'close' }).end();
    }
  }

  private buildServer(): McpServer {
    const mcp = new McpServer({ name: this.name, version: '0.1.0' });
    for (const t of this.tools) {
      mcp.registerTool(t.name, { description: t.description, inputSchema: t.input }, async (args: unknown) => {
        try {
          const value = await t.run(args);
          return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
        } catch (err) {
          return { content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }], isError: true };
        }
      });
    }
    return mcp;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/mcpHost.test.ts && npm run typecheck`
Expected: PASS. If `registerTool`'s callback typing rejects `(args: unknown)`, type the parameter as `Record<string, unknown>` and keep the body the same.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(mcp): loopback MCP host with bearer auth for boss tools

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Boss session and chat

**Files:**
- Modify: `src/shared/types.ts`, `src/main/store/projectStore.ts`
- Create: `src/main/boss/bossSession.ts`
- Test: `test/bossSession.test.ts`

**Interfaces:**
- Consumes: `AgentManager` (+ `setSessionId`, `setLive`, `agent-replied`, `task-finished`), `renderPrompt` (boss), `ClaudeRunnerOptions`, `AgentRunner`.
- Produces:
```ts
// shared/types.ts
export type ChatEntry =
  | { kind: 'user'; at: string; text: string }
  | { kind: 'boss'; at: string; text: string }
  | { kind: 'tool'; at: string; tool: string; input: Record<string, unknown> }
  | { kind: 'event'; at: string; text: string; taskId?: string }
  | { kind: 'report'; at: string; text: string }
  | { kind: 'error'; at: string; text: string };
// ProjectStore
appendChat(projectId: string, entry: ChatEntry): Promise<void>;
readChat(projectId: string, limit?: number): Promise<ChatEntry[]>;
// bossSession.ts
export interface BossSessionDeps { project: Project; manager: AgentManager; roles: RoleStore; skills: SkillStore; store: ProjectStore;
  createRunner: (o: ClaudeRunnerOptions) => AgentRunner; claudeBin: string; promptDir: string; mcpConfigPath: string; isolateUserSettings: boolean; now?: () => Date }
export class BossSession extends EventEmitter {
  start(): void; send(text: string): Promise<void>; notify(text: string, taskId?: string): Promise<void>;
  report(text: string): Promise<void>; history(limit?: number): Promise<ChatEntry[]>; stop(): Promise<void>;
  on(event: 'chat', l: (e: ChatEntry) => void): this;
}
export function describeFinished(task: Task, agentName: string): string;
```

- [ ] **Step 1: Write the failing test** — `test/bossSession.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { BossSession, describeFinished } from '../src/main/boss/bossSession';
import { ClaudeRunner } from '../src/main/claude/runner';
import type { ChatEntry, Task } from '../src/shared/types';
import { harness, type Harness } from './helpers/manager';
import { FAKE_CLAUDE } from './helpers/runner';

let h: Harness;
beforeEach(async () => { h = await harness(); });
afterEach(async () => { await h.cleanup(); });

async function setup() {
  const env = await h.make();
  await env.manager.createBoss('Max');
  const chat: ChatEntry[] = [];
  const boss = new BossSession({
    project: env.project, manager: env.manager, roles: env.roles, skills: env.skills, store: env.store,
    createRunner: (o) => new ClaudeRunner({ ...o, bin: process.execPath, binArgs: [FAKE_CLAUDE], env: { ...process.env, ...h.fakeEnv } }),
    claudeBin: 'claude', promptDir: h.paths.promptDir, mcpConfigPath: path.join(h.data, 'mcp.json'), isolateUserSettings: true,
  });
  boss.on('chat', (e) => chat.push(e));
  boss.start();
  const until = (pred: (e: ChatEntry) => boolean, ms = 20000) => new Promise<ChatEntry>((resolve, reject) => {
    const found = chat.find(pred);
    if (found) return resolve(found);
    const timer = setTimeout(() => reject(new Error('timed out waiting for chat')), ms);
    boss.on('chat', function l(e: ChatEntry) { if (pred(e)) { clearTimeout(timer); boss.off('chat', l); resolve(e); } });
  });
  return { ...env, boss, chat, until };
}

describe('BossSession', () => {
  it('runs the boss in the repo with MCP, read-only tools and the boss prompt', async () => {
    const { boss, until } = await setup();
    await boss.send('Plan dark mode');
    await until((e) => e.kind === 'boss');
    const [launch] = await h.launches();
    expect(launch.argv).toEqual(expect.arrayContaining(['--mcp-config', path.join(h.data, 'mcp.json'), '--strict-mcp-config', '--model', 'opus']));
    const tools = launch.argv.slice(launch.argv.indexOf('--tools') + 1, launch.argv.indexOf('--allowedTools'));
    expect(tools).toEqual(['Read', 'Grep', 'Glob']);
    expect(launch.argv.slice(launch.argv.indexOf('--allowedTools') + 1)).toEqual(['mcp__agentoffice']);
    await boss.stop();
  });

  it('records the conversation and persists it', async () => {
    const { boss, chat, until, store, project } = await setup();
    await boss.send('Hello boss');
    await until((e) => e.kind === 'boss');
    expect(chat.map((e) => e.kind)).toEqual(['user', 'boss']);
    expect(chat[1]).toMatchObject({ text: 'echo: Hello boss' });
    expect((await store.readChat(project.id)).map((e) => e.kind)).toEqual(['user', 'boss']);
    expect((await boss.history()).length).toBe(2);
    await boss.stop();
  });

  it('tells the boss when an employee finishes', async () => {
    const { boss, manager, until } = await setup();
    await manager.hire('frontend');
    await manager.createTask({ assignee: 'Pixel', title: 'Toggle', brief: 'b', createdBy: 'boss' });
    const ev = await until((e) => e.kind === 'event');
    expect(ev).toMatchObject({ taskId: 'T-101', text: expect.stringContaining('T-101 by Pixel finished') });
    const reply = await until((e) => e.kind === 'boss');
    expect(reply).toMatchObject({ text: expect.stringContaining('[AgentOffice] T-101 by Pixel finished') });
    await boss.stop();
  });

  it('shows an error when the boss crashes and resumes on the next message', async () => {
    const { boss, until, chat } = await setup();
    h.fakeEnv.FAKE_CLAUDE_CRASH = '1';
    await boss.send('first');
    await until((e) => e.kind === 'error');
    expect(chat.find((e) => e.kind === 'error')).toMatchObject({ text: expect.stringContaining('will restart with your next message') });
    delete h.fakeEnv.FAKE_CLAUDE_CRASH;
    await boss.send('second');
    await until((e) => e.kind === 'boss');
    const launches = await h.launches();
    expect(launches).toHaveLength(2);
    expect(launches[1].argv).toContain('--resume');
    await boss.stop();
  });

  it('keeps reports in the chat', async () => {
    const { boss, chat } = await setup();
    await boss.report('Two of three tasks done');
    expect(chat).toEqual([expect.objectContaining({ kind: 'report', text: 'Two of three tasks done' })]);
    await boss.stop();
  });
});

describe('describeFinished', () => {
  it('summarises status, summary and files', () => {
    const t = { id: 'T-7', status: 'review', resultSummary: 'Added it', diffStat: [{ path: 'a.ts', add: 3, del: 1 }] } as Task;
    expect(describeFinished(t, 'Pixel')).toBe('T-7 by Pixel finished successfully. Summary: Added it Files: a.ts (+3 −1). Read it with get_task, then request_merge or message_agent.');
    expect(describeFinished({ ...t, status: 'needs_help', diffStat: [] }, 'Pixel')).toMatch(/^T-7 by Pixel finished with problems\. Summary: Added it Files: none\./);
  });
});
```

- [ ] **Step 1b: Keep the fake boss from editing files**

In `test/fake-claude/fake-claude.mjs`, change the `FAKE_CLAUDE_FILE` line so a session started with `--mcp-config` (the boss) never writes. This matches the real boss, which has no editing tools, and keeps the repo clean for merges:
```js
  if (env.FAKE_CLAUDE_FILE && !argv.includes('--mcp-config')) fs.appendFileSync(env.FAKE_CLAUDE_FILE, `turn ${turns}: ${content.split('\n')[0]}\n`);
```

Note: the crash test works because the boss's runner is created on demand, after the env change, and `--resume` is used because the boss's session id was saved on `init` before the fake crashed.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/bossSession.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Add `ChatEntry` to `src/shared/types.ts`**

```ts
export type ChatEntry =
  | { kind: 'user'; at: string; text: string }
  | { kind: 'boss'; at: string; text: string }
  | { kind: 'tool'; at: string; tool: string; input: Record<string, unknown> }
  | { kind: 'event'; at: string; text: string; taskId?: string }
  | { kind: 'report'; at: string; text: string }
  | { kind: 'error'; at: string; text: string };
```

- [ ] **Step 4: Add chat persistence to `ProjectStore`**

```ts
  appendChat(projectId: string, entry: ChatEntry): Promise<void> {
    return appendJsonl(this.paths.chatFile(projectId), entry);
  }

  async readChat(projectId: string, limit = 500): Promise<ChatEntry[]> {
    return (await readJsonl(this.paths.chatFile(projectId), limit)) as ChatEntry[];
  }
```
(add `ChatEntry` to the type import).

- [ ] **Step 5: Write `src/main/boss/bossSession.ts`**

```ts
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ChatEntry, Project, RunnerEvent, Task } from '../../shared/types';
import type { AgentManager, ManagerEvent } from '../agents/agentManager';
import { renderPrompt } from '../agents/prompt';
import type { AgentRunner, ClaudeRunnerOptions } from '../claude/runner';
import type { ProjectStore } from '../store/projectStore';
import type { RoleStore } from '../store/roleStore';
import type { SkillStore } from '../store/skillStore';

const MCP_PREFIX = 'mcp__agentoffice__';

export interface BossSessionDeps {
  project: Project;
  manager: AgentManager;
  roles: RoleStore;
  skills: SkillStore;
  store: ProjectStore;
  createRunner: (o: ClaudeRunnerOptions) => AgentRunner;
  claudeBin: string;
  promptDir: string;
  mcpConfigPath: string;
  isolateUserSettings: boolean;
  now?: () => Date;
}

export function describeFinished(task: Task, agentName: string): string {
  const files = task.diffStat && task.diffStat.length > 0 ? task.diffStat.map((f) => `${f.path} (+${f.add} −${f.del})`).join(', ') : 'none';
  const how = task.status === 'review' ? 'successfully' : 'with problems';
  return `${task.id} by ${agentName} finished ${how}. Summary: ${(task.resultSummary ?? '').trim()} Files: ${files}. Read it with get_task, then request_merge or message_agent.`;
}

export class BossSession extends EventEmitter {
  private runner: AgentRunner | null = null;
  private textThisTurn = false;
  private stopping = false;
  private detach: (() => void) | null = null;
  /** Delivery is serialized so two quick messages never start two boss processes. */
  private delivery: Promise<void> = Promise.resolve();
  private events: Promise<void> = Promise.resolve();

  constructor(private readonly d: BossSessionDeps) {
    super();
  }

  start(): void {
    const onEvent = (e: ManagerEvent) => {
      if (e.type === 'task-finished') this.notify(describeFinished(e.task, e.agent.name), e.task.id).catch(() => undefined);
      if (e.type === 'agent-replied') this.notify(`${e.agent.name} replied: ${e.text}`).catch(() => undefined);
    };
    this.d.manager.on('event', onEvent);
    this.detach = () => { this.d.manager.off('event', onEvent); };
  }

  history(limit = 500): Promise<ChatEntry[]> {
    return this.d.store.readChat(this.d.project.id, limit);
  }

  async send(text: string): Promise<void> {
    await this.add({ kind: 'user', at: this.now(), text });
    await this.deliver(text);
  }

  async notify(text: string, taskId?: string): Promise<void> {
    await this.add({ kind: 'event', at: this.now(), text, ...(taskId ? { taskId } : {}) });
    await this.deliver(`[AgentOffice] ${text}`);
  }

  async report(text: string): Promise<void> {
    await this.add({ kind: 'report', at: this.now(), text });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.detach?.();
    this.detach = null;
    this.runner?.stop();
    await this.delivery;
  }

  private deliver(text: string): Promise<void> {
    const next = this.delivery.then(async () => {
      if (this.stopping) return;
      const runner = await this.ensureRunner();
      if (runner.running) runner.send(text);
    });
    this.delivery = next.catch(() => undefined);
    return next.catch(async (err: unknown) => {
      await this.add({ kind: 'error', at: this.now(), text: `Could not reach the boss: ${err instanceof Error ? err.message : String(err)}` });
    });
  }

  private async ensureRunner(): Promise<AgentRunner> {
    if (this.runner?.running) return this.runner;
    const boss = this.d.manager.agents().find((a) => a.kind === 'boss');
    if (!boss) throw new Error('This project has no boss yet');
    const role = await this.d.roles.get(boss.roleId);
    if (!role) throw new Error(`Role ${boss.roleId} is missing`);
    const skills = await this.d.skills.getMany(role.skills);
    const promptFile = path.join(this.d.promptDir, `${boss.id}.md`);
    await fs.mkdir(this.d.promptDir, { recursive: true });
    await fs.writeFile(promptFile, renderPrompt(role, skills, {
      agentName: boss.name, bossName: boss.name, branch: this.d.project.baseBranch, projectName: this.d.project.name, kind: 'boss',
    }));
    const runner = this.d.createRunner({
      bin: this.d.claudeBin,
      cwd: this.d.project.repoPath,
      launch: {
        model: role.model,
        permissionMode: role.permissionMode,
        tools: role.allowedTools,
        allowedTools: ['mcp__agentoffice'],
        appendSystemPromptFile: promptFile,
        mcpConfigPath: this.d.mcpConfigPath,
        resume: boss.sessionId,
        sessionId: boss.sessionId ? undefined : randomUUID(),
        isolateUserSettings: this.d.isolateUserSettings,
      },
    });
    runner.on('event', (ev) => {
      this.events = this.events.then(() => this.onEvent(boss.id, runner, ev)).catch(() => undefined);
    });
    this.runner = runner;
    this.textThisTurn = false;
    runner.start();
    return runner;
  }

  private async onEvent(bossId: string, runner: AgentRunner, ev: RunnerEvent): Promise<void> {
    await this.d.manager.setLive(bossId, ev).catch(() => undefined);
    switch (ev.type) {
      case 'init':
        this.textThisTurn = false;
        if (ev.sessionId) await this.d.manager.setSessionId(bossId, ev.sessionId).catch(() => undefined);
        break;
      case 'text':
        this.textThisTurn = true;
        await this.add({ kind: 'boss', at: this.now(), text: ev.text });
        break;
      case 'tool_use':
        if (ev.name.startsWith(MCP_PREFIX)) await this.add({ kind: 'tool', at: this.now(), tool: ev.name.slice(MCP_PREFIX.length), input: ev.input });
        break;
      case 'result':
        if (!ev.ok) await this.add({ kind: 'error', at: this.now(), text: `The boss hit a problem: ${ev.text}` });
        else if (!this.textThisTurn && ev.text.trim()) await this.add({ kind: 'boss', at: this.now(), text: ev.text });
        this.textThisTurn = false;
        break;
      case 'exit':
        if (this.runner === runner) this.runner = null;
        if (!this.stopping && ev.code !== 0) {
          const tail = runner.lastStderr;
          await this.add({ kind: 'error', at: this.now(), text: `The boss session stopped (${ev.code ?? ev.signal}). It will restart with your next message.${tail ? `\n${tail}` : ''}` });
        }
        break;
      default:
        break;
    }
  }

  private async add(entry: ChatEntry): Promise<void> {
    await this.d.store.appendChat(this.d.project.id, entry).catch(() => undefined);
    this.emit('chat', entry);
  }

  private now(): string {
    return (this.d.now?.() ?? new Date()).toISOString();
  }
}
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run test/bossSession.test.ts && npm run typecheck`
Expected: PASS. In the crash test the fake crashes after emitting `init`, so `setSessionId` ran and the second launch uses `--resume`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(boss): BossSession runs the boss with MCP and turns its output into chat

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: ProjectService and merge approvals

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/main/workspace/approvalBroker.ts`, `src/main/workspace/projectService.ts`
- Test: `src/main/workspace/approvalBroker.test.ts`, `test/projectService.test.ts`

**Interfaces:**
- Consumes: all of the above.
- Produces:
```ts
// shared/types.ts
export interface MergeRequest { requestId: string; taskId: string; title: string; agentName: string; diffStat: DiffStat[]; summary: string }
export interface WorkspaceSnapshot { project: Project; agents: Agent[]; tasks: Task[]; chat: ChatEntry[]; merges: MergeRequest[] }
export type WorkspaceEvent =
  | { type: 'agents'; agents: Agent[] } | { type: 'tasks'; tasks: Task[] } | { type: 'chat'; entry: ChatEntry }
  | { type: 'agent-event'; agentId: string; event: RunnerEvent } | { type: 'merge-request'; request: MergeRequest }
  | { type: 'merge-resolved'; requestId: string } | { type: 'error'; message: string };
// approvalBroker.ts
export class ApprovalBroker { request(r: Omit<MergeRequest, 'requestId'>): { requestId: string; decision: Promise<boolean> }; answer(id: string, ok: boolean): boolean; pending(): MergeRequest[]; rejectAll(): void }
// projectService.ts
export interface ProjectServiceDeps { paths: DataPaths; resourcesDir: string; claudeBin: string; claudeBinArgs?: string[]; claudeEnv?: NodeJS.ProcessEnv; isolateUserSettings?: boolean }
export class ProjectService extends EventEmitter {
  init(): Promise<void>; listProjects(): Promise<Project[]>; open(repoPath: string, bossName?: string): Promise<WorkspaceSnapshot>;
  current(): Project | null; snapshot(): Promise<WorkspaceSnapshot>; sendToBoss(text: string): Promise<void>;
  listRoles(): Promise<Role[]>; hire(roleId: string, name?: string): Promise<Agent>;
  pauseTask(id: string): Promise<void>; resumeTask(id: string): Promise<void>; cancelTask(id: string): Promise<void>;
  answerMerge(requestId: string, ok: boolean): Promise<void>; tools(): ToolDef[]; close(): Promise<void>;
  on(event: 'event', l: (e: WorkspaceEvent) => void): this;
}
export function projectIdFor(root: string): string;
```

- [ ] **Step 1: Add the types** to `src/shared/types.ts`

```ts
export interface MergeRequest {
  requestId: string;
  taskId: string;
  title: string;
  agentName: string;
  diffStat: DiffStat[];
  summary: string;
}

export interface WorkspaceSnapshot {
  project: Project;
  agents: Agent[];
  tasks: Task[];
  chat: ChatEntry[];
  merges: MergeRequest[];
}

export type WorkspaceEvent =
  | { type: 'agents'; agents: Agent[] }
  | { type: 'tasks'; tasks: Task[] }
  | { type: 'chat'; entry: ChatEntry }
  | { type: 'agent-event'; agentId: string; event: RunnerEvent }
  | { type: 'merge-request'; request: MergeRequest }
  | { type: 'merge-resolved'; requestId: string }
  | { type: 'error'; message: string };
```

- [ ] **Step 2: Write the failing tests**

`src/main/workspace/approvalBroker.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { ApprovalBroker } from './approvalBroker';

const req = { taskId: 'T-1', title: 't', agentName: 'Pixel', diffStat: [], summary: 's' };

describe('ApprovalBroker', () => {
  it('resolves a decision once and lists pending requests', async () => {
    const b = new ApprovalBroker();
    const { requestId, decision } = b.request(req);
    expect(b.pending()).toEqual([{ ...req, requestId }]);
    expect(b.answer(requestId, true)).toBe(true);
    expect(await decision).toBe(true);
    expect(b.answer(requestId, false)).toBe(false);
    expect(b.pending()).toEqual([]);
  });

  it('rejects everything on shutdown', async () => {
    const b = new ApprovalBroker();
    const a = b.request(req);
    const c = b.request({ ...req, taskId: 'T-2' });
    b.rejectAll();
    expect(await a.decision).toBe(false);
    expect(await c.decision).toBe(false);
    expect(b.pending()).toEqual([]);
  });
});
```

`test/projectService.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectService, projectIdFor } from '../src/main/workspace/projectService';
import { dataPaths } from '../src/main/store/paths';
import type { WorkspaceEvent } from '../src/shared/types';
import { makeRepo } from './helpers/repo';
import { FAKE_CLAUDE } from './helpers/runner';

let repo: string;
let data: string;
let svc: ProjectService;
let events: WorkspaceEvent[];
const fakeEnv: Record<string, string> = {};

beforeEach(async () => {
  repo = await makeRepo();
  data = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-svc-'));
  for (const k of Object.keys(fakeEnv)) delete fakeEnv[k];
  fakeEnv.FAKE_CLAUDE_FILE = 'notes.txt';
  svc = new ProjectService({ paths: dataPaths(data), resourcesDir: path.resolve('resources'), claudeBin: process.execPath, claudeBinArgs: [FAKE_CLAUDE], claudeEnv: fakeEnv as NodeJS.ProcessEnv });
  await svc.init();
  events = [];
  svc.on('event', (e) => events.push(e));
});
afterEach(async () => {
  await svc.close();
  await fs.rm(repo, { recursive: true, force: true });
  await fs.rm(data, { recursive: true, force: true });
});

const until = (pred: (e: WorkspaceEvent) => boolean, ms = 20000) => new Promise<WorkspaceEvent>((resolve, reject) => {
  const hit = events.find(pred);
  if (hit) return resolve(hit);
  const timer = setTimeout(() => reject(new Error('timed out waiting for workspace event')), ms);
  svc.on('event', function l(e: WorkspaceEvent) { if (pred(e)) { clearTimeout(timer); svc.off('event', l); resolve(e); } });
});
const tool = (name: string, args: unknown = {}) => svc.tools().find((t) => t.name === name)!.run(args);

describe('ProjectService', () => {
  it('rejects a folder that is not a git repo', async () => {
    const plain = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-plain-'));
    await expect(svc.open(plain)).rejects.toThrow(/not a git repository/);
    expect(svc.current()).toBeNull();
  });

  it('opens a repo with a boss, seeded roles and a stable id', async () => {
    const snap = await svc.open(repo);
    expect(snap.project).toMatchObject({ id: projectIdFor(repo), name: path.basename(repo), baseBranch: 'main', autoMerge: false });
    expect(snap.agents).toEqual([expect.objectContaining({ kind: 'boss', name: 'Max' })]);
    expect((await svc.listRoles()).length).toBe(8);
    await svc.sendToBoss('hello');
    await until((e) => e.type === 'chat' && e.entry.kind === 'boss');
    await svc.close();
    const again = await svc.open(repo);
    expect(again.project.id).toBe(snap.project.id);
    expect(again.agents.filter((a) => a.kind === 'boss')).toHaveLength(1);
    expect(again.chat.map((c) => c.kind)).toEqual(['user', 'boss']);
  });

  it('asks the user before merging, then merges and tells the boss', async () => {
    await svc.open(repo);
    await tool('hire', { role_id: 'frontend' });
    await tool('assign_task', { agent: 'Pixel', title: 'Notes', brief: 'write notes' });
    await until((e) => e.type === 'tasks' && e.tasks.some((t) => t.id === 'T-101' && t.status === 'review'));
    expect(await tool('request_merge', { task_id: 'T-101' })).toMatchObject({ status: 'awaiting_user_approval' });
    const ask = (await until((e) => e.type === 'merge-request')) as Extract<WorkspaceEvent, { type: 'merge-request' }>;
    expect(ask.request).toMatchObject({ taskId: 'T-101', agentName: 'Pixel', diffStat: [{ path: 'notes.txt', add: 1, del: 0 }] });
    expect((await svc.snapshot()).merges).toHaveLength(1);
    await svc.answerMerge(ask.request.requestId, true);
    await until((e) => e.type === 'chat' && e.entry.kind === 'event' && /Merge of T-101: merged/.test(e.entry.text));
    expect((await svc.snapshot()).tasks.find((t) => t.id === 'T-101')!.status).toBe('done');
    expect(await fs.readFile(path.join(repo, 'notes.txt'), 'utf8')).toContain('turn 1');
    expect((await svc.snapshot()).merges).toEqual([]);
  });

  it('tells the boss when the user declines or the merge is blocked', async () => {
    await svc.open(repo);
    await tool('hire', { role_id: 'frontend' });
    await tool('assign_task', { agent: 'Pixel', title: 'Notes', brief: 'write notes' });
    await until((e) => e.type === 'tasks' && e.tasks.some((t) => t.id === 'T-101' && t.status === 'review'));
    await tool('request_merge', { task_id: 'T-101' });
    const first = (await until((e) => e.type === 'merge-request')) as Extract<WorkspaceEvent, { type: 'merge-request' }>;
    await svc.answerMerge(first.request.requestId, false);
    await until((e) => e.type === 'chat' && e.entry.kind === 'event' && /declined to merge T-101/.test(e.entry.text));

    await fs.writeFile(path.join(repo, 'dirty.txt'), 'x');
    events = [];
    await tool('request_merge', { task_id: 'T-101' });
    const second = (await until((e) => e.type === 'merge-request')) as Extract<WorkspaceEvent, { type: 'merge-request' }>;
    await svc.answerMerge(second.request.requestId, true);
    await until((e) => e.type === 'chat' && e.entry.kind === 'event' && /Merge of T-101: blocked/.test(e.entry.text));
    expect((await svc.snapshot()).tasks.find((t) => t.id === 'T-101')!.status).toBe('review');
  });

  it('merges straight away when auto-merge is on', async () => {
    const paths = dataPaths(data);
    const id = projectIdFor(repo);
    await fs.mkdir(paths.projectDir(id), { recursive: true });
    await fs.writeFile(paths.projectFile(id), JSON.stringify({ id, name: 'x', repoPath: repo, baseBranch: 'main', maxConcurrent: 4, bossCanHire: true, autoMerge: true }));
    await svc.open(repo);
    await tool('hire', { role_id: 'frontend' });
    await tool('assign_task', { agent: 'Pixel', title: 'Notes', brief: 'write notes' });
    await until((e) => e.type === 'tasks' && e.tasks.some((t) => t.id === 'T-101' && t.status === 'review'));
    expect(await tool('request_merge', { task_id: 'T-101' })).toMatchObject({ status: 'merged' });
  });
});
```

`claudeEnv` is read every time a runner is created, so tests can change `fakeEnv` between steps.

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run src/main/workspace test/projectService.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Write `src/main/workspace/approvalBroker.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { MergeRequest } from '../../shared/types';

interface Pending { request: MergeRequest; resolve: (ok: boolean) => void }

export class ApprovalBroker {
  private readonly items = new Map<string, Pending>();

  request(r: Omit<MergeRequest, 'requestId'>): { requestId: string; decision: Promise<boolean> } {
    const requestId = randomUUID();
    const decision = new Promise<boolean>((resolve) => {
      this.items.set(requestId, { request: { ...r, requestId }, resolve });
    });
    return { requestId, decision };
  }

  answer(requestId: string, ok: boolean): boolean {
    const p = this.items.get(requestId);
    if (!p) return false;
    this.items.delete(requestId);
    p.resolve(ok);
    return true;
  }

  pending(): MergeRequest[] {
    return [...this.items.values()].map((p) => p.request);
  }

  rejectAll(): void {
    for (const id of [...this.items.keys()]) this.answer(id, false);
  }
}
```

- [ ] **Step 5: Write `src/main/workspace/projectService.ts`**

```ts
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Agent, Project, Role, Task, WorkspaceEvent, WorkspaceSnapshot } from '../../shared/types';
import { AgentManager, type ManagerEvent, type MergeOutcome } from '../agents/agentManager';
import { bossTools, type ToolDef } from '../agents/bossTools';
import { BossSession } from '../boss/bossSession';
import { ClaudeRunner, type ClaudeRunnerOptions } from '../claude/runner';
import { WorktreeManager, inspectRepo, slugify } from '../git/worktrees';
import { McpHost } from '../mcp/mcpHost';
import type { DataPaths } from '../store/paths';
import { ProjectStore } from '../store/projectStore';
import { RoleStore } from '../store/roleStore';
import { SkillStore } from '../store/skillStore';
import { ApprovalBroker } from './approvalBroker';

export interface ProjectServiceDeps {
  paths: DataPaths;
  resourcesDir: string;
  claudeBin: string;
  claudeBinArgs?: string[];
  /** Read each time a runner is created. */
  claudeEnv?: NodeJS.ProcessEnv;
  isolateUserSettings?: boolean;
}

interface Workspace {
  project: Project;
  manager: AgentManager;
  host: McpHost;
  boss: BossSession;
  broker: ApprovalBroker;
  tools: ToolDef[];
}

export function projectIdFor(root: string): string {
  const resolved = path.resolve(root);
  return `${slugify(path.basename(resolved), 'project')}-${createHash('sha1').update(resolved).digest('hex').slice(0, 8)}`;
}

function describeMerge(taskId: string, r: MergeOutcome): string {
  switch (r.status) {
    case 'merged': return `Merge of ${taskId}: merged into the main branch.`;
    case 'conflict': return `Merge of ${taskId}: conflict in ${r.files.join(', ')}. The branch was left as it was; ask the employee to rebase on the main branch and resolve it.`;
    case 'blocked': return `Merge of ${taskId}: blocked. ${r.reason}`;
    case 'not_ready': return `Merge of ${taskId}: not ready. ${r.reason}`;
  }
}

export class ProjectService extends EventEmitter {
  private readonly store: ProjectStore;
  private readonly roles: RoleStore;
  private readonly skills: SkillStore;
  private ws: Workspace | null = null;

  constructor(private readonly d: ProjectServiceDeps) {
    super();
    this.store = new ProjectStore(d.paths);
    this.roles = new RoleStore(d.paths.rolesDir);
    this.skills = new SkillStore(d.paths.skillsDir);
  }

  async init(): Promise<void> {
    await this.roles.seed(path.join(this.d.resourcesDir, 'roles'));
    await this.skills.seed(path.join(this.d.resourcesDir, 'skills'));
  }

  listProjects(): Promise<Project[]> { return this.store.listProjects(); }
  listRoles(): Promise<Role[]> { return this.roles.list(); }
  current(): Project | null { return this.ws?.project ?? null; }
  tools(): ToolDef[] { return this.mustWs().tools; }

  async open(repoPath: string, bossName = 'Max'): Promise<WorkspaceSnapshot> {
    const info = await inspectRepo(repoPath);
    await this.close();
    const id = projectIdFor(info.root);
    const project: Project = (await this.store.getProject(id)) ?? {
      id, name: path.basename(info.root), repoPath: info.root, baseBranch: info.branch, maxConcurrent: 4, bossCanHire: true, autoMerge: false,
    };
    project.repoPath = info.root;
    await this.store.saveProject(project);

    const createRunner = (o: ClaudeRunnerOptions) => new ClaudeRunner({ ...o, binArgs: this.d.claudeBinArgs, env: this.d.claudeEnv ? { ...process.env, ...this.d.claudeEnv } : undefined });
    const isolate = this.d.isolateUserSettings ?? true;
    const manager = new AgentManager({
      project, store: this.store, roles: this.roles, skills: this.skills, worktrees: new WorktreeManager(info.root),
      createRunner, claudeBin: this.d.claudeBin, promptDir: this.d.paths.promptDir, isolateUserSettings: isolate,
    });
    await manager.load();
    const bossAgent = await manager.createBoss(bossName);
    project.bossId = bossAgent.id;
    await this.store.saveProject(project);

    const broker = new ApprovalBroker();
    // The tools need the boss session and the boss session needs the MCP config; `ws` closes the loop.
    let ws!: Workspace;
    const tools = bossTools({
      manager, roles: this.roles, project,
      requestMerge: (task) => this.requestMerge(ws, task),
      report: (text) => { void ws.boss.report(text); },
    });
    const host = new McpHost(tools);
    await host.start();
    const mcpConfigPath = path.join(this.d.paths.projectDir(id), 'mcp.json');
    await host.writeConfig(mcpConfigPath);
    const boss = new BossSession({
      project, manager, roles: this.roles, skills: this.skills, store: this.store, createRunner,
      claudeBin: this.d.claudeBin, promptDir: this.d.paths.promptDir, mcpConfigPath, isolateUserSettings: isolate,
    });
    ws = { project, manager, host, boss, broker, tools };
    manager.on('event', (e: ManagerEvent) => this.forward(ws, e));
    boss.on('chat', (entry) => this.emitWs(ws, { type: 'chat', entry }));
    boss.start();
    this.ws = ws;
    return this.snapshot();
  }

  async snapshot(): Promise<WorkspaceSnapshot> {
    const ws = this.mustWs();
    return { project: { ...ws.project }, agents: ws.manager.agents(), tasks: ws.manager.tasks(), chat: await ws.boss.history(200), merges: ws.broker.pending() };
  }

  sendToBoss(text: string): Promise<void> { return this.mustWs().boss.send(text); }
  hire(roleId: string, name?: string): Promise<Agent> { return this.mustWs().manager.hire(roleId, name); }
  pauseTask(id: string): Promise<void> { return this.mustWs().manager.pauseTask(id); }
  resumeTask(id: string): Promise<void> { return this.mustWs().manager.resumeTask(id); }
  cancelTask(id: string): Promise<void> { return this.mustWs().manager.cancelTask(id); }

  async answerMerge(requestId: string, ok: boolean): Promise<void> {
    if (!this.mustWs().broker.answer(requestId, ok)) throw new Error('That merge request is no longer pending');
  }

  async close(): Promise<void> {
    const ws = this.ws;
    if (!ws) return;
    this.ws = null;
    ws.broker.rejectAll();
    await ws.boss.stop();
    await ws.manager.shutdown();
    await ws.host.close();
  }

  private async requestMerge(ws: Workspace, task: Task): Promise<unknown> {
    if (ws.project.autoMerge) return ws.manager.merge(task.id);
    const agentName = ws.manager.findAgent(task.assigneeId)?.name ?? 'unknown';
    const { requestId, decision } = ws.broker.request({
      taskId: task.id, title: task.title, agentName, diffStat: task.diffStat ?? [], summary: task.resultSummary ?? '',
    });
    this.emitWs(ws, { type: 'merge-request', request: ws.broker.pending().find((r) => r.requestId === requestId)! });
    void decision.then(async (ok) => {
      if (this.ws !== ws) return;
      this.emitWs(ws, { type: 'merge-resolved', requestId });
      if (!ok) return ws.boss.notify(`The user declined to merge ${task.id}.`, task.id);
      const outcome = await ws.manager.merge(task.id).catch((e: unknown) => ({ status: 'blocked' as const, reason: e instanceof Error ? e.message : String(e) }));
      return ws.boss.notify(describeMerge(task.id, outcome), task.id);
    }).catch(() => undefined);
    return { status: 'awaiting_user_approval', note: 'The user has been asked. You will get an [AgentOffice] message with the outcome.' };
  }

  private forward(ws: Workspace, e: ManagerEvent): void {
    switch (e.type) {
      case 'agents-changed': return this.emitWs(ws, { type: 'agents', agents: ws.manager.agents() });
      case 'tasks-changed':
      case 'task-finished': return this.emitWs(ws, { type: 'tasks', tasks: ws.manager.tasks() });
      case 'agent-event': return this.emitWs(ws, { type: 'agent-event', agentId: e.agentId, event: e.event });
      case 'error': return this.emitWs(ws, { type: 'error', message: e.message });
      default: return undefined;
    }
  }

  private emitWs(ws: Workspace, e: WorkspaceEvent): void {
    if (this.ws === ws) this.emit('event', e);
  }

  private mustWs(): Workspace {
    if (!this.ws) throw new Error('No project is open');
    return this.ws;
  }
}
```

Note: `emitWs` drops events from a workspace that has since been closed, so a late event from an old project never reaches the UI of a new one. In `open()`, `this.ws` is set after the listeners are attached; events emitted before that are dropped. That is fine because `open()` returns a fresh snapshot.

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/main/workspace test/projectService.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(workspace): ProjectService wires boss, MCP host and merge approvals

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: IPC, preload and main-process wiring

**Files:**
- Modify: `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/index.ts`
- Test: `src/shared/ipc.test.ts` (existing test covers the new names)

**Interfaces:**
- Produces:
```ts
export const IPC = {
  appStatus: 'app:status', pickFolder: 'project:pick-folder', listProjects: 'project:list', openProject: 'project:open',
  snapshot: 'project:snapshot', sendToBoss: 'boss:send', listRoles: 'team:roles', hire: 'team:hire',
  pauseTask: 'task:pause', resumeTask: 'task:resume', cancelTask: 'task:cancel', answerMerge: 'merge:answer', event: 'workspace:event',
} as const;
export interface AgentOfficeApi {
  getStatus(): Promise<AppStatus>; pickFolder(): Promise<string | null>; listProjects(): Promise<Project[]>;
  openProject(repoPath: string): Promise<WorkspaceSnapshot>; snapshot(): Promise<WorkspaceSnapshot | null>;
  sendToBoss(text: string): Promise<void>; listRoles(): Promise<Role[]>; hire(roleId: string, name?: string): Promise<Agent>;
  pauseTask(id: string): Promise<void>; resumeTask(id: string): Promise<void>; cancelTask(id: string): Promise<void>;
  answerMerge(requestId: string, ok: boolean): Promise<void>; onEvent(cb: (e: WorkspaceEvent) => void): () => void;
}
```

- [ ] **Step 1: Write `src/shared/ipc.ts`** with the constants and interface above (imports: `Agent, AppStatus, Project, Role, WorkspaceEvent, WorkspaceSnapshot` from `./types`).

- [ ] **Step 2: Run the IPC test**

Run: `npx vitest run src/shared/ipc.test.ts`
Expected: PASS (all names unique and match `/^[a-z]+:[a-z-]+$/`).

- [ ] **Step 3: Write `src/preload/index.ts`**

```ts
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC, type AgentOfficeApi } from '../shared/ipc';
import type { WorkspaceEvent } from '../shared/types';

const api: AgentOfficeApi = {
  getStatus: () => ipcRenderer.invoke(IPC.appStatus),
  pickFolder: () => ipcRenderer.invoke(IPC.pickFolder),
  listProjects: () => ipcRenderer.invoke(IPC.listProjects),
  openProject: (repoPath) => ipcRenderer.invoke(IPC.openProject, repoPath),
  snapshot: () => ipcRenderer.invoke(IPC.snapshot),
  sendToBoss: (text) => ipcRenderer.invoke(IPC.sendToBoss, text),
  listRoles: () => ipcRenderer.invoke(IPC.listRoles),
  hire: (roleId, name) => ipcRenderer.invoke(IPC.hire, roleId, name),
  pauseTask: (id) => ipcRenderer.invoke(IPC.pauseTask, id),
  resumeTask: (id) => ipcRenderer.invoke(IPC.resumeTask, id),
  cancelTask: (id) => ipcRenderer.invoke(IPC.cancelTask, id),
  answerMerge: (requestId, ok) => ipcRenderer.invoke(IPC.answerMerge, requestId, ok),
  onEvent: (cb) => {
    const listener = (_e: IpcRendererEvent, event: WorkspaceEvent) => cb(event);
    ipcRenderer.on(IPC.event, listener);
    return () => { ipcRenderer.removeListener(IPC.event, listener); };
  },
};

contextBridge.exposeInMainWorld('agentOffice', api);
```

- [ ] **Step 4: Rewrite `src/main/index.ts`**

```ts
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'node:path';
import { IPC } from '../shared/ipc';
import { getAppStatus } from './appStatus';
import { fixGuiPath } from './claude/shellPath';
import { dataPaths } from './store/paths';
import { ProjectService } from './workspace/projectService';

let win: BrowserWindow | null = null;
let service: ProjectService | null = null;

const str = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || v.length === 0 || v.length > 100_000) throw new Error(`Invalid ${name}`);
  return v;
};

function createWindow(): void {
  win = new BrowserWindow({
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
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win?.webContents.getURL()) e.preventDefault();
  });
  win.on('closed', () => { win = null; });
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'));
}

function resourcesDir(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'resources') : path.join(app.getAppPath(), 'resources');
}

function registerIpc(svc: ProjectService): void {
  ipcMain.handle(IPC.appStatus, () => getAppStatus());
  ipcMain.handle(IPC.pickFolder, async () => {
    const r = win ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] }) : await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0] ?? null;
  });
  ipcMain.handle(IPC.listProjects, () => svc.listProjects());
  ipcMain.handle(IPC.openProject, (_e, repoPath: unknown) => svc.open(str(repoPath, 'folder')));
  ipcMain.handle(IPC.snapshot, () => (svc.current() ? svc.snapshot() : null));
  ipcMain.handle(IPC.sendToBoss, (_e, text: unknown) => svc.sendToBoss(str(text, 'message')));
  ipcMain.handle(IPC.listRoles, () => svc.listRoles());
  ipcMain.handle(IPC.hire, (_e, roleId: unknown, name: unknown) => svc.hire(str(roleId, 'role'), typeof name === 'string' && name.trim() ? name : undefined));
  ipcMain.handle(IPC.pauseTask, (_e, id: unknown) => svc.pauseTask(str(id, 'task id')));
  ipcMain.handle(IPC.resumeTask, (_e, id: unknown) => svc.resumeTask(str(id, 'task id')));
  ipcMain.handle(IPC.cancelTask, (_e, id: unknown) => svc.cancelTask(str(id, 'task id')));
  ipcMain.handle(IPC.answerMerge, (_e, requestId: unknown, ok: unknown) => svc.answerMerge(str(requestId, 'request id'), ok === true));
}

app.whenReady().then(async () => {
  fixGuiPath();
  const status = getAppStatus();
  service = new ProjectService({
    paths: dataPaths(app.getPath('userData')),
    resourcesDir: resourcesDir(),
    claudeBin: status.claude?.path ?? 'claude',
    isolateUserSettings: true,
  });
  await service.init();
  service.on('event', (e) => win?.webContents.send(IPC.event, e));
  registerIpc(service);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

let quitting = false;
app.on('before-quit', (e) => {
  if (quitting || !service) return;
  e.preventDefault();
  quitting = true;
  void service.close().finally(() => app.quit());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

- [ ] **Step 5: Typecheck and build**

Run: `npm run typecheck && npm run build && npm test`
Expected: all succeed. If the build bundles `@modelcontextprotocol/sdk` badly, check that it is in `dependencies` (not `devDependencies`) so `externalizeDepsPlugin` leaves it external.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(app): workspace IPC, preload API, navigation guards and clean quit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Workspace UI (team, tasks, boss chat, merge approvals)

**Files:**
- Create: `src/renderer/src/state.ts`, `src/renderer/src/components/Onboarding.tsx`, `src/renderer/src/components/Workspace.tsx`, `src/renderer/src/components/TeamPanel.tsx`, `src/renderer/src/components/TaskBoard.tsx`, `src/renderer/src/components/BossChat.tsx`, `src/renderer/src/workspace.css`
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/main.tsx`
- Test: `src/renderer/src/state.test.ts`

**Interfaces:**
- Consumes: `AgentOfficeApi` (Task 7), `WorkspaceSnapshot`/`WorkspaceEvent` (Task 6).
- Produces: `reducer(state: UiState, action: UiAction): UiState`, `initialState`, `UiState = { ws: WorkspaceSnapshot | null; logs: Record<string, RunnerEvent[]>; errors: string[] }`.

- [ ] **Step 1: Write the failing test** — `src/renderer/src/state.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { initialState, reducer, type UiState } from './state';
import type { WorkspaceSnapshot } from '../../shared/types';

const ws: WorkspaceSnapshot = {
  project: { id: 'p', name: 'demo', repoPath: '/r', baseBranch: 'main', maxConcurrent: 4, bossCanHire: true, autoMerge: false },
  agents: [], tasks: [], chat: [], merges: [],
};
const opened: UiState = reducer(initialState, { type: 'snapshot', ws });

describe('ui reducer', () => {
  it('loads a snapshot and applies list replacements', () => {
    const s = reducer(opened, { type: 'event', event: { type: 'agents', agents: [{ id: 'a', projectId: 'p', name: 'Pixel', roleId: 'frontend', kind: 'employee', status: 'idle', bubble: 'Idle' }] } });
    expect(s.ws!.agents).toHaveLength(1);
  });

  it('appends chat and tracks merge requests until resolved', () => {
    let s = reducer(opened, { type: 'event', event: { type: 'chat', entry: { kind: 'user', at: 't', text: 'hi' } } });
    s = reducer(s, { type: 'event', event: { type: 'merge-request', request: { requestId: 'r1', taskId: 'T-1', title: 't', agentName: 'Pixel', diffStat: [], summary: '' } } });
    expect(s.ws!.chat).toHaveLength(1);
    expect(s.ws!.merges).toHaveLength(1);
    s = reducer(s, { type: 'event', event: { type: 'merge-resolved', requestId: 'r1' } });
    expect(s.ws!.merges).toEqual([]);
  });

  it('caps per-agent logs at 200 events and keeps the latest', () => {
    let s = opened;
    for (let i = 0; i < 250; i++) s = reducer(s, { type: 'event', event: { type: 'agent-event', agentId: 'a', event: { type: 'text', text: String(i) } } });
    expect(s.logs.a).toHaveLength(200);
    expect(s.logs.a.at(-1)).toEqual({ type: 'text', text: '249' });
  });

  it('keeps the last five errors and can dismiss one', () => {
    let s = opened;
    for (let i = 0; i < 7; i++) s = reducer(s, { type: 'event', event: { type: 'error', message: `e${i}` } });
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
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/renderer/src/state.ts`**

```ts
import type { RunnerEvent, WorkspaceEvent, WorkspaceSnapshot } from '../../shared/types';

export interface UiState {
  ws: WorkspaceSnapshot | null;
  logs: Record<string, RunnerEvent[]>;
  errors: string[];
}

export type UiAction =
  | { type: 'snapshot'; ws: WorkspaceSnapshot }
  | { type: 'event'; event: WorkspaceEvent }
  | { type: 'error'; message: string }
  | { type: 'dismiss-error'; index: number };

export const initialState: UiState = { ws: null, logs: {}, errors: [] };
const LOG_CAP = 200;

export function reducer(s: UiState, a: UiAction): UiState {
  switch (a.type) {
    case 'snapshot':
      return { ...s, ws: a.ws, logs: {} };
    case 'error':
      return { ...s, errors: [...s.errors, a.message].slice(-5) };
    case 'dismiss-error':
      return { ...s, errors: s.errors.filter((_, i) => i !== a.index) };
    case 'event':
      return applyEvent(s, a.event);
  }
}

function applyEvent(s: UiState, e: WorkspaceEvent): UiState {
  if (e.type === 'error') return { ...s, errors: [...s.errors, e.message].slice(-5) };
  if (e.type === 'agent-event') {
    const prev = s.logs[e.agentId] ?? [];
    return { ...s, logs: { ...s.logs, [e.agentId]: [...prev, e.event].slice(-LOG_CAP) } };
  }
  if (!s.ws) return s;
  switch (e.type) {
    case 'agents': return { ...s, ws: { ...s.ws, agents: e.agents } };
    case 'tasks': return { ...s, ws: { ...s.ws, tasks: e.tasks } };
    case 'chat': return { ...s, ws: { ...s.ws, chat: [...s.ws.chat, e.entry] } };
    case 'merge-request': return { ...s, ws: { ...s.ws, merges: [...s.ws.merges.filter((m) => m.requestId !== e.request.requestId), e.request] } };
    case 'merge-resolved': return { ...s, ws: { ...s.ws, merges: s.ws.merges.filter((m) => m.requestId !== e.requestId) } };
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/renderer/src/state.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the components**

`src/renderer/src/components/Onboarding.tsx`:
```tsx
import { useEffect, useState } from 'react';
import type { Project, WorkspaceSnapshot } from '../../../shared/types';

export function Onboarding({ onOpened }: { onOpened: (ws: WorkspaceSnapshot) => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { window.agentOffice.listProjects().then(setProjects, () => setProjects([])); }, []);

  const open = async (repoPath: string | null) => {
    if (!repoPath) return;
    setBusy(true);
    setError(null);
    try {
      onOpened(await window.agentOffice.openProject(repoPath));
    } catch (e) {
      setError(String(e).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, ''));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="onboarding">
      <h1>AgentOffice</h1>
      <p className="muted">Open a git repository. A boss agent will build the team for it.</p>
      <button type="button" className="primary" disabled={busy} onClick={async () => open(await window.agentOffice.pickFolder())}>
        {busy ? 'Opening…' : 'Open a project folder…'}
      </button>
      {error && <p className="bad" role="alert">{error}</p>}
      {projects.length > 0 && (
        <section aria-label="Recent projects">
          <h2>Recent projects</h2>
          <ul className="recent">
            {projects.map((p) => (
              <li key={p.id}>
                <button type="button" disabled={busy} onClick={() => open(p.repoPath)}>
                  <strong>{p.name}</strong> <span className="mono muted">{p.repoPath}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
```

`src/renderer/src/components/TeamPanel.tsx`:
```tsx
import { useEffect, useState } from 'react';
import type { Agent, Role, RunnerEvent } from '../../../shared/types';

const dot: Record<Agent['status'], string> = {
  idle: '#6e7288', thinking: '#f5b942', working: '#52d1be', waiting: '#7aa2ff', done: '#8bd47a', error: '#ff7a6b', paused: '#a3a6b8',
};

function logLine(e: RunnerEvent): string | null {
  switch (e.type) {
    case 'tool_use': return `${e.name} ${JSON.stringify(e.input).slice(0, 80)}`;
    case 'text': return e.text.slice(0, 160);
    case 'result': return e.ok ? 'finished' : `failed: ${e.text.slice(0, 120)}`;
    case 'stderr': return `stderr: ${e.text.slice(0, 120)}`;
    default: return null;
  }
}

export function TeamPanel({ agents, logs, onError }: { agents: Agent[]; logs: Record<string, RunnerEvent[]>; onError: (m: string) => void }) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [roleId, setRoleId] = useState('frontend');
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => { window.agentOffice.listRoles().then(setRoles, () => setRoles([])); }, []);
  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? id;
  const lines = (selected ? logs[selected] ?? [] : []).map(logLine).filter((l): l is string => l !== null).slice(-30);

  const hire = async () => {
    try {
      await window.agentOffice.hire(roleId, name.trim() || undefined);
      setName('');
    } catch (e) {
      onError(String(e));
    }
  };

  return (
    <section className="panel team" aria-label="Team">
      <h2>Team</h2>
      <ul className="agents">
        {agents.map((a) => (
          <li key={a.id}>
            <button type="button" className={selected === a.id ? 'agent selected' : 'agent'} onClick={() => setSelected(selected === a.id ? null : a.id)}>
              <span className="dot" style={{ background: dot[a.status] }} aria-hidden="true" />
              <span className="agent-name">{a.name}</span>
              <span className="muted small">{a.kind === 'boss' ? 'Boss' : roleName(a.roleId)}</span>
              <span className="bubble small">{a.bubble}</span>
            </button>
          </li>
        ))}
      </ul>
      {selected && (
        <div className="log mono small" aria-label="Agent activity">
          {lines.length === 0 ? <p className="muted">No activity yet.</p> : lines.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}
      <form className="hire" onSubmit={(e) => { e.preventDefault(); void hire(); }}>
        <label htmlFor="hire-role">Hire</label>
        <select id="hire-role" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
          {roles.filter((r) => r.id !== 'boss').map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <label htmlFor="hire-name" className="sr-only">Name (optional)</label>
        <input id="hire-name" placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit">Hire</button>
      </form>
    </section>
  );
}
```

`src/renderer/src/components/TaskBoard.tsx`:
```tsx
import type { Agent, Task, TaskStatus } from '../../../shared/types';

const COLUMNS: { title: string; statuses: TaskStatus[] }[] = [
  { title: 'Queued', statuses: ['queued'] },
  { title: 'Working', statuses: ['working'] },
  { title: 'Needs help', statuses: ['needs_help', 'failed'] },
  { title: 'Review', statuses: ['review'] },
  { title: 'Done', statuses: ['done', 'cancelled'] },
];

export function TaskBoard({ tasks, agents, onError }: { tasks: Task[]; agents: Agent[]; onError: (m: string) => void }) {
  const who = (id: string) => agents.find((a) => a.id === id)?.name ?? '?';
  const act = (fn: () => Promise<void>) => () => { fn().catch((e: unknown) => onError(String(e))); };

  return (
    <section className="panel board" aria-label="Tasks">
      <h2>Tasks</h2>
      <div className="columns">
        {COLUMNS.map((c) => {
          const items = tasks.filter((t) => c.statuses.includes(t.status));
          return (
            <div key={c.title} className="column">
              <h3>{c.title} <span className="muted small">{items.length}</span></h3>
              {items.map((t) => (
                <article key={t.id} className="card">
                  <div className="mono small muted">{t.id} · {who(t.assigneeId)}{t.held ? ' · paused' : ''}{t.status === 'cancelled' ? ' · cancelled' : ''}</div>
                  <div className="card-title">{t.title}</div>
                  {t.resultSummary && (
                    <details>
                      <summary className="small">Result</summary>
                      <p className="small pre">{t.resultSummary}</p>
                      {t.diffStat && t.diffStat.length > 0 && (
                        <ul className="mono small files">{t.diffStat.map((f) => <li key={f.path}>{f.path} <span className="add">+{f.add}</span> <span className="del">−{f.del}</span></li>)}</ul>
                      )}
                    </details>
                  )}
                  <div className="card-actions">
                    {t.status === 'working' && <button type="button" onClick={act(() => window.agentOffice.pauseTask(t.id))}>Pause</button>}
                    {t.status === 'queued' && t.held && <button type="button" onClick={act(() => window.agentOffice.resumeTask(t.id))}>Resume</button>}
                    {['queued', 'working', 'needs_help', 'review'].includes(t.status) && (
                      <button type="button" className="danger" onClick={act(() => window.agentOffice.cancelTask(t.id))}>Cancel</button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}
```

`src/renderer/src/components/BossChat.tsx`:
```tsx
import { useEffect, useRef, useState } from 'react';
import type { ChatEntry, MergeRequest } from '../../../shared/types';

function Entry({ e }: { e: ChatEntry }) {
  switch (e.kind) {
    case 'user': return <div className="msg user">{e.text}</div>;
    case 'boss': return <div className="msg boss pre">{e.text}</div>;
    case 'report': return <div className="msg report pre">{e.text}</div>;
    case 'error': return <div className="msg error pre" role="alert">{e.text}</div>;
    case 'event': return <div className="msg event small">{e.text}</div>;
    case 'tool': return (
      <div className="msg tool mono small">
        <span className="tool-name">{e.tool}</span> {JSON.stringify(e.input).slice(0, 200)}
      </div>
    );
  }
}

export function BossChat({ chat, merges, onError }: { chat: ChatEntry[]; merges: MergeRequest[]; onError: (m: string) => void }) {
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

  return (
    <section className="panel chat" aria-label="Boss chat">
      <h2>Boss</h2>
      <div className="messages">
        {chat.length === 0 && <p className="muted">Tell the boss what to build.</p>}
        {chat.map((e, i) => <Entry key={i} e={e} />)}
        {merges.map((m) => (
          <div key={m.requestId} className="merge-card" role="group" aria-label={`Merge request for ${m.taskId}`}>
            <div><strong>Merge {m.taskId}?</strong> {m.title} <span className="muted">by {m.agentName}</span></div>
            {m.summary && <p className="small pre">{m.summary}</p>}
            {m.diffStat.length > 0 && <ul className="mono small files">{m.diffStat.map((f) => <li key={f.path}>{f.path} <span className="add">+{f.add}</span> <span className="del">−{f.del}</span></li>)}</ul>}
            <div className="card-actions">
              <button type="button" className="primary" onClick={() => answer(m.requestId, true)}>Merge</button>
              <button type="button" onClick={() => answer(m.requestId, false)}>Decline</button>
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <label htmlFor="boss-msg" className="sr-only">Message the boss</label>
        <textarea
          id="boss-msg"
          rows={3}
          value={draft}
          placeholder="Describe what the team should build… (Enter to send, Shift+Enter for a new line)"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
        />
        <button type="submit" className="primary">Send</button>
      </form>
    </section>
  );
}
```

`src/renderer/src/components/Workspace.tsx`:
```tsx
import type { UiState } from '../state';
import { BossChat } from './BossChat';
import { TaskBoard } from './TaskBoard';
import { TeamPanel } from './TeamPanel';

export function Workspace({ state, onError, onDismiss }: { state: UiState; onError: (m: string) => void; onDismiss: (i: number) => void }) {
  const ws = state.ws!;
  return (
    <div className="workspace">
      <header className="ws-header">
        <h1>{ws.project.name}</h1>
        <span className="mono muted small">{ws.project.repoPath} · {ws.project.baseBranch}</span>
      </header>
      {state.errors.length > 0 && (
        <div className="errors" role="alert">
          {state.errors.map((m, i) => (
            <div key={i} className="error-row">
              <span>{m.replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '')}</span>
              <button type="button" aria-label="Dismiss error" onClick={() => onDismiss(i)}>×</button>
            </div>
          ))}
        </div>
      )}
      <div className="ws-body">
        <TeamPanel agents={ws.agents} logs={state.logs} onError={onError} />
        <TaskBoard tasks={ws.tasks} agents={ws.agents} onError={onError} />
        <BossChat chat={ws.chat} merges={ws.merges} onError={onError} />
      </div>
    </div>
  );
}
```

`src/renderer/src/App.tsx`:
```tsx
import { useEffect, useReducer, useState } from 'react';
import type { AppStatus } from '../../shared/types';
import { Onboarding } from './components/Onboarding';
import { Workspace } from './components/Workspace';
import { initialState, reducer } from './state';

export function App() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    window.agentOffice.getStatus().then(setStatus, () => setStatus({ platform: 'unknown', claude: null }));
    window.agentOffice.snapshot().then((ws) => { if (ws) dispatch({ type: 'snapshot', ws }); }, () => undefined);
    return window.agentOffice.onEvent((event) => dispatch({ type: 'event', event }));
  }, []);

  if (!status) return <main className="boot"><p>Looking for Claude Code…</p></main>;
  if (!status.claude) {
    return (
      <main className="boot">
        <h1>AgentOffice</h1>
        <div className="bad">
          <p>Claude Code was not found on this computer.</p>
          <p>Install it, sign in with <code>claude</code> once in a terminal, then restart AgentOffice.</p>
        </div>
      </main>
    );
  }
  if (!state.ws) return <Onboarding onOpened={(ws) => dispatch({ type: 'snapshot', ws })} />;
  return <Workspace state={state} onError={(message) => dispatch({ type: 'error', message })} onDismiss={(index) => dispatch({ type: 'dismiss-error', index })} />;
}
```

`src/renderer/src/workspace.css` (import it in `main.tsx` after `styles.css`):
```css
:root { --bg: #14151f; --panel: #181926; --card: #222436; --line: #2c2f42; --text: #ece8df; --muted: #a3a6b8; --amber: #f5b942; --teal: #52d1be; --red: #ff7a6b; --green: #8bd47a; }
* { box-sizing: border-box; }
button, input, select, textarea { font: inherit; color: var(--text); background: #1f2130; border: 1px solid #3a3f58; border-radius: 6px; }
button { min-height: 36px; padding: 0 12px; cursor: pointer; }
button:disabled { opacity: 0.6; cursor: default; }
button.primary { background: var(--amber); color: #1a1408; border-color: transparent; font-weight: 600; }
button.danger { color: #ff9a8e; border-color: #6b3a36; background: transparent; }
:focus-visible { outline: 2px solid var(--teal); outline-offset: 2px; }
.mono { font-family: ui-monospace, 'IBM Plex Mono', monospace; }
.muted { color: var(--muted); }
.small { font-size: 12px; }
.pre { white-space: pre-wrap; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.add { color: var(--green); } .del { color: #ff9a8e; }
.onboarding { max-width: 640px; margin: 80px auto; padding: 0 16px; display: flex; flex-direction: column; gap: 16px; }
.recent { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.recent button { width: 100%; text-align: left; min-height: 48px; display: flex; gap: 12px; align-items: center; }
.workspace { height: 100vh; display: flex; flex-direction: column; }
.ws-header { display: flex; align-items: baseline; gap: 12px; padding: 14px 20px; border-bottom: 1px solid var(--line); }
.ws-header h1 { margin: 0; font-size: 20px; }
.errors { padding: 8px 20px; background: #3d1c1c; }
.error-row { display: flex; justify-content: space-between; gap: 12px; align-items: center; color: #ffd0ca; }
.ws-body { flex: 1; min-height: 0; display: grid; grid-template-columns: 280px minmax(0, 1fr) 380px; }
.panel { min-height: 0; overflow: auto; padding: 14px; border-right: 1px solid var(--line); display: flex; flex-direction: column; gap: 10px; }
.panel h2 { margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); }
.agents { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
.agent { width: 100%; display: grid; grid-template-columns: 10px 1fr auto; gap: 4px 8px; align-items: center; text-align: left; padding: 8px 10px; background: var(--card); }
.agent.selected { border-color: var(--amber); }
.agent .bubble { grid-column: 2 / 4; color: var(--muted); }
.dot { width: 10px; height: 10px; }
.agent-name { font-weight: 600; }
.log { background: #0f1018; border: 1px solid var(--line); border-radius: 6px; padding: 8px; max-height: 260px; overflow: auto; display: flex; flex-direction: column; gap: 4px; overflow-wrap: anywhere; }
.hire { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: auto; }
.hire select, .hire input { min-height: 36px; padding: 0 8px; flex: 1 1 120px; }
.columns { display: grid; grid-template-columns: repeat(5, minmax(160px, 1fr)); gap: 10px; overflow-x: auto; }
.column h3 { font-size: 13px; margin: 0 0 8px; }
.card { background: var(--card); border: 1px solid #33374a; border-radius: 6px; padding: 10px; margin-bottom: 8px; display: flex; flex-direction: column; gap: 6px; }
.card-title { font-weight: 500; }
.card-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.files { list-style: none; padding: 0; margin: 0; }
.chat { border-right: none; background: var(--panel); }
.messages { flex: 1; overflow: auto; display: flex; flex-direction: column; gap: 10px; }
.msg { padding: 8px 10px; border-radius: 8px; max-width: 92%; overflow-wrap: anywhere; }
.msg.user { align-self: flex-end; background: var(--amber); color: #1a1408; }
.msg.boss { background: #232536; }
.msg.report { background: #123b37; border: 1px solid var(--teal); }
.msg.error { background: #3d1c1c; color: #ffd0ca; }
.msg.event { color: var(--muted); border-top: 1px dashed var(--line); border-radius: 0; max-width: 100%; }
.msg.tool { border: 1px solid var(--line); background: #1c1e2b; }
.tool-name { color: var(--teal); }
.merge-card { border: 2px solid var(--amber); border-radius: 8px; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.composer { display: flex; flex-direction: column; gap: 8px; }
.composer textarea { resize: vertical; padding: 8px 10px; }
@media (max-width: 1100px) { .ws-body { grid-template-columns: 1fr; } .panel { border-right: none; border-bottom: 1px solid var(--line); } }
```

- [ ] **Step 6: Typecheck, test, build**

Run: `npm run typecheck && npm test && npm run build`
Expected: all succeed.

- [ ] **Step 7: Manual check with the fake CLI**

Run the app against the fake CLI so no real usage is spent:
```bash
mkdir -p /tmp/ao-fakebin && printf '#!/bin/sh\nexec node "%s" "$@"\n' "$PWD/test/fake-claude/fake-claude.mjs" > /tmp/ao-fakebin/claude && chmod +x /tmp/ao-fakebin/claude
```
For this check only, temporarily set `claudeBin` in `src/main/index.ts` to `process.env.AO_CLAUDE_BIN ?? status.claude?.path ?? 'claude'`, and keep that line (it's a useful dev override). Then:
`AO_CLAUDE_BIN=/tmp/ao-fakebin/claude npm run dev`
Expected: open a scratch git repo → workspace shows Max; type "hello" → the chat shows "echo: hello"; hire a Frontend Engineer → Pixel appears.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(ui): workspace with team, task board, boss chat and merge approvals

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: End-to-end with the real Claude Code CLI

**Files:**
- Create: `test/real/boss.real.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Write the opt-in test** — `test/real/boss.real.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getAppStatus } from '../../src/main/appStatus';
import { dataPaths } from '../../src/main/store/paths';
import { RoleStore } from '../../src/main/store/roleStore';
import { ProjectService, projectIdFor } from '../../src/main/workspace/projectService';
import { makeRepo } from '../helpers/repo';

// Spends real Claude usage. Run with: AO_REAL_CLAUDE=1 npx vitest run test/real
describe.skipIf(!process.env.AO_REAL_CLAUDE)('real Claude Code end-to-end', () => {
  it('the boss hires, delegates and merges a tiny change', async () => {
    const bin = getAppStatus().claude?.path;
    if (!bin) throw new Error('claude not found');
    const repo = await makeRepo();
    const data = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-real-'));
    const paths = dataPaths(data);
    const svc = new ProjectService({ paths, resourcesDir: path.resolve('resources'), claudeBin: bin, isolateUserSettings: true });
    await svc.init();
    const roles = new RoleStore(paths.rolesDir);
    await roles.save({ ...(await roles.get('boss'))!, model: 'sonnet' });
    await roles.save({ ...(await roles.get('frontend'))!, model: 'haiku' });
    const id = projectIdFor(repo);
    await fs.mkdir(paths.projectDir(id), { recursive: true });
    await fs.writeFile(paths.projectFile(id), JSON.stringify({ id, name: 'real', repoPath: repo, baseBranch: 'main', maxConcurrent: 2, bossCanHire: true, autoMerge: true }));
    const log: string[] = [];
    svc.on('event', (e) => { if (e.type === 'chat') log.push(`${e.entry.kind}: ${'text' in e.entry ? e.entry.text : e.entry.tool}`); });
    try {
      await svc.open(repo);
      await svc.sendToBoss('Hire one Frontend Engineer and ask them to create a file named hello.txt containing exactly the word hi, and commit it. When they finish, merge it. Keep everything short.');
      const deadline = Date.now() + 8 * 60_000;
      while (!existsSync(path.join(repo, 'hello.txt')) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 2000));
      console.log(log.join('\n'));
      expect((await fs.readFile(path.join(repo, 'hello.txt'), 'utf8')).trim()).toBe('hi');
    } finally {
      await svc.close();
      await fs.rm(repo, { recursive: true, force: true });
      await fs.rm(data, { recursive: true, force: true });
    }
  }, 10 * 60_000);
});
```

- [ ] **Step 2: Confirm it is skipped by default**

Run: `npx vitest run test/real`
Expected: 1 skipped.

- [ ] **Step 3: Run it for real once**

Run: `AO_REAL_CLAUDE=1 npx vitest run test/real 2>&1 | tail -40`
Expected: PASS; the printed chat shows `tool: hire`, `tool: assign_task`, an `event` that T-101 finished, and `tool: request_merge`. If it fails, read the chat log and the agent logs under the temp data dir (print the path before cleanup if needed) and debug with superpowers:systematic-debugging. Do not weaken the test.

- [ ] **Step 4: Update the README** — replace the "Status" line and add a "How it works" section:

```markdown
> Status: early development. Runs on macOS, Windows and Linux. You can open a repo, chat with the boss, and watch it hire and delegate; the pixel-art office arrives next.

## How it works
- **Boss:** a long-running `claude` session in your repo with read-only tools plus AgentOffice's MCP tools (`list_team`, `hire`, `assign_task`, `get_task`, `message_agent`, `request_merge`, …). It plans and reviews; it never edits files.
- **Employees:** each task runs as `claude -p` in the employee's own git worktree (`.agentoffice/wt/<name>`) on branch `ao/<name>/<task>`.
- **Merging:** the boss asks; you approve in the chat (unless auto-merge is on). Merges never touch a checkout that has uncommitted changes.
- Real end-to-end test (spends Claude usage): `AO_REAL_CLAUDE=1 npx vitest run test/real`
```

- [ ] **Step 5: Commit and push**

```bash
git add -A
git commit -m "test: opt-in real Claude Code end-to-end; README how it works

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin HEAD
```
Open a PR (draft) so CI runs on all three OSes, and fix anything platform-specific before calling the plan done.

---

## Spec coverage (Plan 2)

| Spec section | Covered by |
|---|---|
| §5 Boss session (long-lived, read-only tools, team context) | Tasks 1, 5 |
| §5 Employees: boss notified on finish, follow-ups via resume | Tasks 3, 5 |
| §6 MCP host (loopback, bearer token, config file) | Task 4 |
| §6 tools: list_team, list_roles, hire, assign_task, get_task, list_tasks, message_agent, request_merge, cancel_task, report_to_user | Task 3 |
| §6 merge approval (autoMerge false by default) | Tasks 2, 6 |
| §8 Boss chat, tool cards, events, merge approval cards; team; task board (plain UI) | Task 8 |
| §9 boss crash, merge conflicts, MCP auth, renderer hardening | Tasks 2, 4, 5, 7 |
| §10 integration tests with fake CLI + real end-to-end | Tasks 2–9 |
| §8 pixel office, role editor, settings, onboarding polish, packaging | **Plan 3** |
