# Task Model Classifier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before an employee task starts, a one-shot Opus call rates the task small/medium/large and the task runs on haiku/sonnet/opus accordingly; roles default to `auto` and can still pin a model.

**Architecture:** A new `classifier.ts` (pure parsing + a runner-backed `TaskClassifier`) is injected into `AgentManager`. `createTask` saves the task with no model and classifies it **outside** the `run()` chain; `runnableTasks` won't pick a task until it has a model; `spawn()` takes the model from the task instead of the role. A one-time migration flips existing employee roles to `auto`. The renderer shows a read-only model chip.

**Tech Stack:** Electron + TypeScript, Vitest, zod, React, the fake Claude CLI in `test/fake-claude/`.

**Spec:** `docs/superpowers/specs/2026-10-14-task-model-classifier-design.md`

## Global Constraints

- Size → model: `small → haiku`, `medium → sonnet`, `large → opus`. Fallback model: `sonnet`. Classifier model: `opus`.
- Classifier timeout: 60 s. Reason text clipped to 200 code points.
- `AUTO_MODEL = 'auto'` must never reach the CLI as `--model auto` (employees, plain questions, or the boss).
- Never `await` a `run()` from inside another `run()` callback (AGENTS.md invariant). Classification runs outside `run()`.
- The boss is never classified; `boss` role is never migrated.
- New `Task` fields are optional so old `tasks.json` loads unchanged.
- Spawn only through `createRunner` / `ClaudeRunner` (args array, cross-platform kill). The classifier's cwd is the app's `promptDir`, **not** the user's repo (it needs no repo access, and in tests the fake CLI writes `FAKE_CLAUDE_FILE` into its cwd).
- Model/agent text rendered only as React text. Use CSS variables from `tokens.css`, no raw hex.
- Commits: Conventional Commits, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work stays on branch `feat/task-model-classifier`.
- Done means `npm run typecheck && npm test && npm run test:e2e` all pass. Do **not** run `test/real`.

## Review Focus

1. **Boss role set to `auto` in RoleEditor** — the boss must still launch with a real model (`opus`), never `--model auto`. Covered in Task 4 (BossSession guard test) and Task 6 (Auto option hidden for the boss role).
2. **App quits while a classification is in flight** — the late result must not be written; the task must be re-classified on the next load and then run. Covered in Task 4 (restart test).
3. **Follow-up feedback on a task picked as haiku** — the reopened session must keep `--model haiku`, not fall back to the role's `auto`. Covered in Task 4 (follow-up test).
4. **Several tasks for one agent while the first is still classifying** — the second must not jump ahead. Covered in Task 3 (`runnableTasks` test).
5. **Classifier reply wrapped in prose or a code fence, or the CLI exits without a result** — parse what is parseable; otherwise fall back to sonnet without throwing. Covered in Task 1 (parse tests) and Task 2 (crash/hang/echo tests).

---

### Task 1: Shared types and pure classifier helpers

**Files:**
- Modify: `src/shared/types.ts` (Task interface near line 35; add new exports)
- Create: `src/main/agents/classifier.ts`
- Test: `src/main/agents/classifier.test.ts`

**Interfaces:**
- Produces (in `src/shared/types.ts`):
  ```ts
  export const AUTO_MODEL = 'auto';
  export type TaskSize = 'small' | 'medium' | 'large';
  export interface ModelPick { model: string; size?: TaskSize; reason: string; source: 'classifier' | 'role' | 'fallback' }
  // Task gains: model?: string; modelPick?: ModelPick;
  ```
- Produces (in `src/main/agents/classifier.ts`):
  ```ts
  export const SIZE_MODEL: Record<TaskSize, string>;   // { small: 'haiku', medium: 'sonnet', large: 'opus' }
  export const FALLBACK_MODEL = 'sonnet';
  export const CLASSIFIER_MODEL = 'opus';
  export interface ClassifyInput { title: string; brief: string; roleName: string }
  export function parseClassification(text: string): { size: TaskSize; reason: string } | null;
  export function classifierPrompt(input: ClassifyInput): string;
  export function fallbackPick(cause: string): ModelPick;
  /** The model to launch with: the task's pick, else the role's model, never 'auto'. */
  export function launchModel(roleModel: string, taskModel?: string): string;
  ```

- [ ] **Step 1: Add the shared types**

In `src/shared/types.ts`, add above `export interface Task`:

```ts
/** Role model value meaning "let the classifier pick per task". */
export const AUTO_MODEL = 'auto';
export type TaskSize = 'small' | 'medium' | 'large';
export interface ModelPick { model: string; size?: TaskSize; reason: string; source: 'classifier' | 'role' | 'fallback' }
```

and inside `Task`, after `diffStat?: DiffStat[];`:

```ts
  /** Model the task runs on; undefined while the classifier is still deciding. */
  model?: string;
  modelPick?: ModelPick;
```

- [ ] **Step 2: Write the failing tests**

`src/main/agents/classifier.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FALLBACK_MODEL, SIZE_MODEL, classifierPrompt, fallbackPick, launchModel, parseClassification } from './classifier';

describe('parseClassification', () => {
  it('reads clean JSON', () => {
    expect(parseClassification('{"size":"small","reason":"one-line copy change"}')).toEqual({ size: 'small', reason: 'one-line copy change' });
  });
  it('reads JSON inside a code fence or surrounded by prose', () => {
    expect(parseClassification('Here you go:\n```json\n{"size": "large", "reason": "new subsystem"}\n```')).toEqual({ size: 'large', reason: 'new subsystem' });
    expect(parseClassification('I think {"size":"medium","reason":"a few files"} fits.')).toEqual({ size: 'medium', reason: 'a few files' });
  });
  it('rejects unknown sizes, missing reasons and junk', () => {
    expect(parseClassification('{"size":"huge","reason":"x"}')).toBeNull();
    expect(parseClassification('{"size":"small"}')).toBeNull();
    expect(parseClassification('{"size":"small","reason":"   "}')).toBeNull();
    expect(parseClassification('echo: hello')).toBeNull();
    expect(parseClassification('{not json}')).toBeNull();
  });
  it('clips long reasons to 200 code points', () => {
    const r = parseClassification(JSON.stringify({ size: 'small', reason: '🙂'.repeat(300) }))!;
    expect(Array.from(r.reason)).toHaveLength(200);
  });
});

describe('model mapping', () => {
  it('maps sizes to models', () => {
    expect(SIZE_MODEL).toEqual({ small: 'haiku', medium: 'sonnet', large: 'opus' });
  });
  it('falls back to sonnet with the cause in the reason', () => {
    expect(fallbackPick('timed out')).toEqual({ model: FALLBACK_MODEL, reason: 'Classifier unavailable: timed out', source: 'fallback' });
  });
  it('never launches with auto', () => {
    expect(launchModel('auto', 'haiku')).toBe('haiku');
    expect(launchModel('auto')).toBe(FALLBACK_MODEL);
    expect(launchModel('opus')).toBe('opus');
    expect(launchModel('opus', 'haiku')).toBe('haiku');
  });
});

describe('classifierPrompt', () => {
  it('includes the task and asks for strict JSON', () => {
    const p = classifierPrompt({ title: 'Fix typo', brief: 'README says "teh"', roleName: 'Writer' });
    expect(p).toContain('Fix typo');
    expect(p).toContain('README says "teh"');
    expect(p).toContain('Writer');
    expect(p).toContain('{"size"');
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/main/agents/classifier.test.ts`
Expected: FAIL — cannot resolve `./classifier`.

- [ ] **Step 4: Implement**

`src/main/agents/classifier.ts`:

```ts
import { z } from 'zod';
import { AUTO_MODEL, type ModelPick, type TaskSize } from '../../shared/types';

export const SIZE_MODEL: Record<TaskSize, string> = { small: 'haiku', medium: 'sonnet', large: 'opus' };
export const FALLBACK_MODEL = 'sonnet';
export const CLASSIFIER_MODEL = 'opus';
const MAX_REASON = 200;

export interface ClassifyInput { title: string; brief: string; roleName: string }

const replySchema = z.object({ size: z.enum(['small', 'medium', 'large']), reason: z.string().trim().min(1) });

/** Pulls the first {...} block out of the reply (tolerates fences and prose) and validates it. */
export function parseClassification(text: string): { size: TaskSize; reason: string } | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let raw: unknown;
  try { raw = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  const r = replySchema.safeParse(raw);
  if (!r.success) return null;
  return { size: r.data.size, reason: Array.from(r.data.reason).slice(0, MAX_REASON).join('') };
}

export function classifierPrompt(i: ClassifyInput): string {
  return [
    'You size coding tasks so each one runs on the cheapest model that can do it well.',
    'Sizes:',
    '- small: one file or a few lines; typo, rename, config tweak, copy change, simple question.',
    '- medium: a contained feature or bug fix touching a few files, with tests.',
    '- large: cross-cutting work, a new subsystem, a multi-module refactor, tricky debugging, or a security-sensitive change.',
    '',
    `Role: ${i.roleName}`,
    `Title: ${i.title}`,
    'Brief:',
    i.brief,
    '',
    'Reply with only this JSON and nothing else: {"size": "small" | "medium" | "large", "reason": "<one short line>"}',
  ].join('\n');
}

export function fallbackPick(cause: string): ModelPick {
  return { model: FALLBACK_MODEL, reason: `Classifier unavailable: ${cause}`, source: 'fallback' };
}

export function launchModel(roleModel: string, taskModel?: string): string {
  if (taskModel) return taskModel;
  return roleModel === AUTO_MODEL ? FALLBACK_MODEL : roleModel;
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run src/main/agents/classifier.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/agents/classifier.ts src/main/agents/classifier.test.ts
git commit -m "feat(agents): task size types and classifier parsing helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Runner-backed classifier (+ fake CLI result override)

**Files:**
- Modify: `test/fake-claude/fake-claude.mjs` (result text, ~line 70)
- Modify: `src/main/agents/classifier.ts` (append `createClassifier`)
- Modify: `AGENTS.md` (fake CLI env var list)
- Test: `test/classifier.test.ts`

**Interfaces:**
- Consumes: `classifierPrompt`, `parseClassification`, `fallbackPick`, `SIZE_MODEL`, `CLASSIFIER_MODEL` (Task 1); `AgentRunner`, `ClaudeRunnerOptions`, `waitForExit` from `src/main/claude/runner.ts`.
- Produces:
  ```ts
  export type TaskClassifier = (input: ClassifyInput) => Promise<ModelPick>;   // never rejects
  export interface ClassifierDeps {
    createRunner: (o: ClaudeRunnerOptions) => AgentRunner;
    claudeBin: string;
    cwd: string;
    isolateUserSettings: boolean;
    timeoutMs?: number;   // default 60_000
  }
  export function createClassifier(d: ClassifierDeps): TaskClassifier;
  ```
- Produces (fake CLI): env `FAKE_CLAUDE_RESULT` — when set, the success `result` text is exactly this string instead of `echo: …`.

- [ ] **Step 1: Add `FAKE_CLAUDE_RESULT` to the fake CLI**

In `test/fake-claude/fake-claude.mjs`, in the final `out({ type: 'result', … })`, change the `result` line to:

```js
    result: fail ? 'simulated failure' : (env.FAKE_CLAUDE_RESULT ?? `echo: ${content.slice(0, 200)}`),
```

In `AGENTS.md`, in the `FAKE_CLAUDE_*` list after `FAKE_CLAUDE_ARGV_OUT`, add:

```md
  - `FAKE_CLAUDE_RESULT`: use this exact text as the success result (e.g. classifier JSON).
```

- [ ] **Step 2: Write the failing tests**

`test/classifier.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ClaudeRunner } from '../src/main/claude/runner';
import { createClassifier } from '../src/main/agents/classifier';
import { FAKE_CLAUDE } from './helpers/runner';

let dir: string;
let argvOut: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-cls-'));
  argvOut = path.join(dir, 'argv.jsonl');
});
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); });

const classifier = (env: Record<string, string>, timeoutMs?: number) => createClassifier({
  createRunner: (o) => new ClaudeRunner({ ...o, bin: process.execPath, binArgs: [FAKE_CLAUDE], env: { ...process.env, FAKE_CLAUDE_ARGV_OUT: argvOut, ...env } }),
  claudeBin: 'claude', cwd: dir, isolateUserSettings: true, timeoutMs,
});
const input = { title: 'Fix typo', brief: 'README says teh', roleName: 'Writer' };

describe('createClassifier', () => {
  it('runs opus with no tools and maps the size to a model', async () => {
    const pick = await classifier({ FAKE_CLAUDE_RESULT: '{"size":"small","reason":"one word"}' })(input);
    expect(pick).toEqual({ model: 'haiku', size: 'small', reason: 'one word', source: 'classifier' });
    const [launch] = (await fs.readFile(argvOut, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as { argv: string[]; cwd: string });
    expect(launch.argv).toEqual(expect.arrayContaining(['--model', 'opus', '--tools', '', '--setting-sources', 'project,local']));
    expect(launch.argv).not.toContain('--resume');
    expect(await fs.realpath(launch.cwd)).toBe(await fs.realpath(dir));
  });

  it('falls back to sonnet on an unparsable reply', async () => {
    const pick = await classifier({})(input);
    expect(pick).toMatchObject({ model: 'sonnet', source: 'fallback', reason: expect.stringContaining('unreadable reply') });
  });

  it('falls back on an error result or a crash', async () => {
    expect(await classifier({ FAKE_CLAUDE_FAIL: '1' })(input)).toMatchObject({ model: 'sonnet', source: 'fallback' });
    expect(await classifier({ FAKE_CLAUDE_CRASH: '1' })(input)).toMatchObject({ model: 'sonnet', source: 'fallback', reason: expect.stringContaining('exited') });
  });

  it('falls back after the timeout and stops the process', async () => {
    const started = Date.now();
    const pick = await classifier({ FAKE_CLAUDE_HANG: '1' }, 300)(input);
    expect(pick).toMatchObject({ model: 'sonnet', source: 'fallback', reason: expect.stringContaining('timed out') });
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('falls back when the CLI cannot be started', async () => {
    const c = createClassifier({
      createRunner: (o) => new ClaudeRunner({ ...o, bin: path.join(dir, 'no-such-claude') }),
      claudeBin: 'x', cwd: dir, isolateUserSettings: true,
    });
    expect(await c(input)).toMatchObject({ model: 'sonnet', source: 'fallback' });
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run test/classifier.test.ts`
Expected: FAIL — `createClassifier` is not exported.

- [ ] **Step 4: Implement `createClassifier`**

Append to `src/main/agents/classifier.ts` (and add the imports at the top):

```ts
import type { RunnerEvent } from '../../shared/types';
import { waitForExit, type AgentRunner, type ClaudeRunnerOptions } from '../claude/runner';

export type TaskClassifier = (input: ClassifyInput) => Promise<ModelPick>;

export interface ClassifierDeps {
  createRunner: (o: ClaudeRunnerOptions) => AgentRunner;
  claudeBin: string;
  /** Working folder for the one-shot session. Not the user's repo: the classifier needs no files. */
  cwd: string;
  isolateUserSettings: boolean;
  timeoutMs?: number;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** One-shot Opus call per task. Never rejects: any failure becomes a sonnet fallback. */
export function createClassifier(d: ClassifierDeps): TaskClassifier {
  return async (input) => {
    let runner: AgentRunner;
    try {
      runner = d.createRunner({
        bin: d.claudeBin, cwd: d.cwd,
        launch: { model: CLASSIFIER_MODEL, tools: [], isolateUserSettings: d.isolateUserSettings },
      });
    } catch (e) {
      return fallbackPick(errText(e));
    }
    const outcome = await new Promise<{ text: string } | { cause: string }>((resolve) => {
      let settled = false;
      const finish = (r: { text: string } | { cause: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        runner.off('event', listener);
        resolve(r);
      };
      const listener = (ev: RunnerEvent) => {
        if (ev.type === 'result') finish(ev.ok ? { text: ev.text } : { cause: 'error result' });
        else if (ev.type === 'exit') finish({ cause: `exited (${ev.code ?? ev.signal ?? 'unknown'})` });
      };
      const timer = setTimeout(() => finish({ cause: 'timed out' }), d.timeoutMs ?? 60_000);
      runner.on('event', listener);
      try {
        runner.start();
        if (runner.running) runner.send(classifierPrompt(input));
      } catch (e) {
        finish({ cause: errText(e) });
      }
    });
    if (runner.running) {
      const exited = waitForExit(runner, 5000);
      runner.endInput();
      runner.stop();
      await exited;
    }
    if ('cause' in outcome) return fallbackPick(outcome.cause);
    const parsed = parseClassification(outcome.text);
    if (!parsed) return fallbackPick('unreadable reply');
    return { model: SIZE_MODEL[parsed.size], size: parsed.size, reason: parsed.reason, source: 'classifier' };
  };
}
```

Note: `runner.start()` on a missing binary does not throw synchronously; cross-spawn emits `error`, which `ClaudeRunner` turns into an `exit` event — handled by the listener.

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run test/classifier.test.ts src/main/agents/classifier.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/agents/classifier.ts test/classifier.test.ts test/fake-claude/fake-claude.mjs AGENTS.md
git commit -m "feat(agents): one-shot Opus task classifier with sonnet fallback

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Queue waits for classification without losing order

**Files:**
- Modify: `src/main/agents/taskRules.ts:21-36` (`runnableTasks`)
- Test: `src/main/agents/taskRules.test.ts`

**Interfaces:**
- Consumes: `Task.model` (Task 1).
- Produces: `runnableTasks` unchanged signature; a queued task whose `model` is undefined is never returned but claims its assignee for the pass.

- [ ] **Step 1: Write the failing test**

In `src/main/agents/taskRules.test.ts`, the `t()` factory builds tasks with no `model`. Existing tests must keep passing, so give the factory a default model: change its spread to `..., updatedAt: '', model: 'sonnet', ...over,`. Then add inside `describe('runnableTasks', …)`:

```ts
  it('skips a task that is still being classified, and keeps later tasks for that agent behind it', () => {
    const tasks = [
      t({ id: 'A', assigneeId: 'a1', model: undefined }),
      t({ id: 'B', assigneeId: 'a1' }),
      t({ id: 'C', assigneeId: 'a2' }),
    ];
    expect(runnableTasks(tasks, new Set(), 4).map((x) => x.id)).toEqual(['C']);
  });

  it('an unclassified task does not use a concurrency slot', () => {
    const tasks = [
      t({ id: 'A', assigneeId: 'a1', model: undefined }),
      t({ id: 'B', assigneeId: 'a2' }),
    ];
    expect(runnableTasks(tasks, new Set(), 1).map((x) => x.id)).toEqual(['B']);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/main/agents/taskRules.test.ts`
Expected: FAIL — first new test returns `['A', 'C']`.

- [ ] **Step 3: Implement**

In `runnableTasks`, inside the `for (const t of queued)` loop, after the `dependsOn` check and before `picked.push(t)`:

```ts
    if (!t.model) { claimed.add(t.assigneeId); continue; }   // still classifying: hold the agent's place in line
```

Leave the `slots` check where it is (at the top of the loop) — an unclassified task doesn't decrement `slots`, so the second test passes.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/main/agents/taskRules.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/agents/taskRules.ts src/main/agents/taskRules.test.ts
git commit -m "feat(agents): queue holds tasks until their model is picked

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: AgentManager classifies tasks and runs them on the picked model

**Files:**
- Modify: `src/main/agents/agentManager.ts` (deps ~line 16, `load` ~line 82, `createTask` ~line 137, `messageAgent` ~line 252, `startTask` ~line 331, `spawn` ~line 370)
- Modify: `src/main/boss/bossSession.ts:130` (guard against `auto`)
- Modify: `src/main/workspace/projectService.ts:110-115` (wire the real classifier)
- Modify: `test/helpers/manager.ts` (harness `classify` option + default stub)
- Modify: `test/agentManager.test.ts:29-33` (`makeManager` passes a stub)
- Test: `test/modelPick.test.ts`, plus a case in `test/bossSession.test.ts`

**Interfaces:**
- Consumes: `TaskClassifier`, `createClassifier`, `launchModel`, `FALLBACK_MODEL` (Tasks 1–2); `AUTO_MODEL`, `ModelPick` (Task 1); `runnableTasks` behaviour (Task 3).
- Produces: `AgentManagerDeps.classify: TaskClassifier` (required). Harness: `h.make({ classify?: TaskClassifier })`. Exported `STUB_PICK: ModelPick` from `test/helpers/manager.ts`.

- [ ] **Step 1: Give the harness and `makeManager` a classifier**

In `test/helpers/manager.ts`:

```ts
import type { TaskClassifier } from '../../src/main/agents/classifier';
import type { ModelPick } from '../../src/shared/types';

export const STUB_PICK: ModelPick = { model: 'sonnet', size: 'medium', reason: 'stub', source: 'classifier' };
```

Change `make(opts?: { maxConcurrent?: number; autoMerge?: boolean })` (both in the `Harness` interface and the implementation) to `make(opts?: { maxConcurrent?: number; autoMerge?: boolean; classify?: TaskClassifier })`, and add to the `new AgentManager({...})` deps:

```ts
        classify: opts.classify ?? (async () => STUB_PICK),
```

In `test/agentManager.test.ts` `makeManager`, add to the deps object `classify: async () => STUB_PICK,` and import `STUB_PICK` from `./helpers/manager`.

- [ ] **Step 2: Write the failing manager tests**

`test/modelPick.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { finished, harness, STUB_PICK, type Harness } from './helpers/manager';
import type { ModelPick } from '../src/shared/types';

let h: Harness;
beforeEach(async () => { h = await harness(); });
afterEach(async () => { await h.cleanup(); });

const modelArg = (argv: string[]) => argv[argv.indexOf('--model') + 1];
function deferred() {
  let release!: (p: ModelPick) => void;
  const promise = new Promise<ModelPick>((r) => { release = r; });
  return { promise, release };
}
const HAIKU: ModelPick = { model: 'haiku', size: 'small', reason: 'one line', source: 'classifier' };

describe('model per task', () => {
  it('waits for the classifier, then runs on the picked model', async () => {
    const d = deferred();
    const classify = vi.fn(() => d.promise);
    const { manager } = await h.make({ classify });
    await manager.hire('frontend');
    const t = await manager.createTask({ assignee: 'Pixel', title: 'Fix typo', brief: 'teh → the', createdBy: 'boss' });
    expect(t.status).toBe('queued');
    await manager.idle();
    expect(manager.getTask(t.id)!.model).toBeUndefined();
    expect(await h.launches()).toHaveLength(0);
    expect(classify).toHaveBeenCalledWith({ title: 'Fix typo', brief: 'teh → the', roleName: 'Frontend Engineer' });

    const done = finished(manager, t.id);
    d.release(HAIKU);
    await done;
    expect(modelArg((await h.launches())[0].argv)).toBe('haiku');
    expect(manager.getTask(t.id)).toMatchObject({ model: 'haiku', modelPick: HAIKU });
  });

  it('a pinned role skips the classifier', async () => {
    const classify = vi.fn(async () => HAIKU);
    const { manager, roles } = await h.make({ classify });
    const fe = (await roles.get('frontend'))!;
    await roles.save({ ...fe, model: 'opus' });
    await manager.hire('frontend');
    const t = await manager.createTask({ assignee: 'Pixel', title: 'a', brief: 'a', createdBy: 'boss' });
    await finished(manager, t.id);
    expect(classify).not.toHaveBeenCalled();
    expect(modelArg((await h.launches())[0].argv)).toBe('opus');
    expect(manager.getTask(t.id)!.modelPick).toEqual({ model: 'opus', reason: 'Pinned by role', source: 'role' });
  });

  it('follow-up feedback keeps the task model', async () => {
    const { manager } = await h.make({ classify: async () => HAIKU });
    await manager.hire('frontend');
    const t = await manager.createTask({ assignee: 'Pixel', title: 'a', brief: 'a', createdBy: 'boss' });
    await finished(manager, t.id);
    await manager.idle();
    const again = finished(manager, t.id);
    await manager.messageAgent('Pixel', 'also dark mode');
    await again;
    const last = (await h.launches()).at(-1)!.argv;
    expect(last).toContain('--resume');
    expect(modelArg(last)).toBe('haiku');
  });

  it('a plain question to an auto role uses sonnet, never auto', async () => {
    const { manager } = await h.make({ classify: async () => HAIKU });
    await manager.hire('frontend');
    const t = await manager.createTask({ assignee: 'Pixel', title: 'a', brief: 'a', createdBy: 'boss' });
    await finished(manager, t.id);
    await manager.merge(t.id);
    await manager.idle();
    await manager.messageAgent('Pixel', 'what did you learn?');
    await manager.idle();
    await vi.waitFor(async () => expect((await h.launches()).length).toBe(2));
    expect(modelArg((await h.launches())[1].argv)).toBe('sonnet');
  });

  it('drops a result that arrives after shutdown and re-classifies on the next load', async () => {
    const d = deferred();
    const first = await h.make({ classify: () => d.promise });
    await first.manager.hire('frontend');
    const t = await first.manager.createTask({ assignee: 'Pixel', title: 'a', brief: 'a', createdBy: 'boss' });
    await first.manager.shutdown();
    d.release(HAIKU);
    await new Promise((r) => setTimeout(r, 100));   // let the late result reach run()
    await first.manager.idle();
    expect((await first.store.getTasks('p1'))[0].model).toBeUndefined();

    const second = await h.make({ classify: async () => STUB_PICK });
    await finished(second.manager, t.id);
    expect(modelArg((await h.launches())[0].argv)).toBe('sonnet');
  });
});
```

In `test/bossSession.test.ts`, inside `describe('BossSession', …)`, add (the boss reads its role lazily on the first send, so saving after `setup()` is in time):

```ts
  it('never launches the boss with --model auto', async () => {
    const { boss, until, roles } = await setup();
    await roles.save({ ...(await roles.get('boss'))!, model: 'auto' });
    await boss.send('hello');
    await until((e) => e.kind === 'boss');
    const [launch] = await h.launches();
    expect(launch.argv[launch.argv.indexOf('--model') + 1]).toBe('opus');
    await boss.stop();
  });
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run test/modelPick.test.ts test/bossSession.test.ts`
Expected: FAIL — type error / `classify` never called, tasks run with role model `sonnet`.

- [ ] **Step 4: Implement in `AgentManager`**

1. Imports: add `AUTO_MODEL` to the `../../shared/types` import, and `import { launchModel, type TaskClassifier } from './classifier';`.
2. `AgentManagerDeps`: add `classify: TaskClassifier;`.
3. `createTask`: inside the `run()` callback, after building `t` and before `this.taskList.push(t)`:

```ts
      const role = await this.d.roles.get(agent.roleId);
      if (role && role.model !== AUTO_MODEL) {
        t.model = role.model;
        t.modelPick = { model: role.model, reason: 'Pinned by role', source: 'role' };
      }
```

   After the `run()` resolves and before `await this.pump();`:

```ts
    if (!task.model) void this.classifyTask(task.id);
```

4. New private method (place it in the internals section):

```ts
  /** Runs outside run(): a slow classifier must never hold the state chain. Never rejects. */
  private async classifyTask(taskId: string): Promise<void> {
    const t = this.taskList.find((x) => x.id === taskId);
    if (!t) return;
    const agent = this.agentList.find((a) => a.id === t.assigneeId);
    const role = agent ? await this.d.roles.get(agent.roleId).catch(() => undefined) : undefined;
    const pick = await this.d.classify({ title: t.title, brief: t.brief, roleName: role?.name ?? 'Engineer' });
    await this.run(async () => {
      if (this.closed) return;   // the next load() classifies again
      const now = this.taskList.find((x) => x.id === taskId);
      if (!now || now.status !== 'queued' || now.model) return;
      now.model = pick.model;
      now.modelPick = pick;
      now.updatedAt = this.now();
      await this.saveTasks();
      this.emitEvent({ type: 'tasks-changed' });
    }).catch(() => undefined);
    this.pump().catch(() => undefined);
  }
```

5. `load()`: before `return requeued;` add:

```ts
    for (const t of this.taskList) if (t.status === 'queued' && !t.model) void this.classifyTask(t.id);
```

6. `spawn()`: add a `model: string` parameter after `taskId` — signature becomes `spawn(agent, role, cwd, promptFile, taskId, model)` — and use `model` instead of `role.model` in `launch`.
7. Call sites:
   - `startTask`: `this.spawn(agent, role, wt, promptFile, task.id, launchModel(role.model, task.model))`
   - `messageAgent` open-task branch: `this.spawn(agent, role, wt, …, open.id, launchModel(role.model, open.model))`
   - `messageAgent` plain-question branch: `this.spawn(agent, role, agent.worktreePath, …, null, launchModel(role.model))`

- [ ] **Step 5: Guard the boss**

In `src/main/boss/bossSession.ts` line ~130, replace `model: role.model,` with:

```ts
        // The boss is never classified; 'auto' would be an invalid --model.
        model: role.model === AUTO_MODEL ? 'opus' : role.model,
```

and import `AUTO_MODEL` from `../../shared/types`.

- [ ] **Step 6: Wire the real classifier in `ProjectService.open`**

In `src/main/workspace/projectService.ts`, import `createClassifier` from `../agents/classifier`, and add to the `new AgentManager({...})` deps:

```ts
      classify: createClassifier({ createRunner, claudeBin: this.claudeBin, cwd: this.d.paths.promptDir, isolateUserSettings: isolate }),
```

The classifier's `cwd` must exist: add `await fs.mkdir(this.d.paths.promptDir, { recursive: true });` just before `new AgentManager` (import `promises as fs` from `node:fs` if not already imported).

- [ ] **Step 7: Run to verify pass**

Run: `npx vitest run test/modelPick.test.ts test/bossSession.test.ts && npm run typecheck && npm test`
Expected: PASS everywhere. If an older test fails because it checked a task was `working` straight after `createTask`, make it wait for the start event first — `await waitFor(manager, (e) => e.type === 'agent-event' && e.event.type === 'init')` — and say in the commit message which tests changed. Don't change what they assert.

- [ ] **Step 8: Commit**

```bash
git add src/main/agents/agentManager.ts src/main/boss/bossSession.ts src/main/workspace/projectService.ts test/helpers/manager.ts test/agentManager.test.ts test/modelPick.test.ts test/bossSession.test.ts
git commit -m "feat(agents): classify each task and run it on the picked model

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Roles default to auto, existing roles migrated once

**Files:**
- Modify: `resources/roles/{backend,designer,devops,frontend,qa,security,writer}.json` (`"model": "auto"`; **not** `boss.json`)
- Modify: `src/shared/types.ts:120` (`AppSettings`)
- Modify: `src/main/store/validate.ts:31-34` (`settingsSchema`)
- Create: `src/main/store/migrations.ts`
- Modify: `src/main/index.ts` (~line 145, after `await service.init()`)
- Modify: `src/renderer/src/team/roleForm.ts` (`blankRole` model)
- Test: `src/main/store/migrations.test.ts`

**Interfaces:**
- Consumes: `AUTO_MODEL` (Task 1), `RoleStore` (`list()`, `save()`), `SettingsStore` (`get()`, `save()`).
- Produces: `export async function migrateRolesToAuto(roles: RoleStore, settings: SettingsStore): Promise<number>` — returns how many roles changed; `AppSettings.autoModelMigrated?: boolean`.

- [ ] **Step 1: Write the failing test**

`src/main/store/migrations.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RoleStore } from './roleStore';
import { SettingsStore } from './settingsStore';
import { migrateRolesToAuto } from './migrations';

let dir: string;
let roles: RoleStore;
let settings: SettingsStore;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-mig-'));
  roles = new RoleStore(path.join(dir, 'roles'));
  settings = new SettingsStore(path.join(dir, 'settings.json'));
  await roles.seed(path.resolve('resources/roles'));
});
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); });

describe('migrateRolesToAuto', () => {
  it('moves every employee role (built-in or custom) to auto, never the boss, and only once', async () => {
    const fe = (await roles.get('frontend'))!;
    await roles.save({ ...fe, model: 'sonnet' });
    await roles.save({ ...fe, id: 'custom', name: 'Custom', model: 'haiku' });
    await roles.save({ ...(await roles.get('boss'))!, model: 'sonnet' });

    await migrateRolesToAuto(roles, settings);
    const all = await roles.list();
    expect(all.filter((r) => r.id !== 'boss').every((r) => r.model === 'auto')).toBe(true);
    expect((await roles.get('boss'))!.model).toBe('sonnet');
    expect((await settings.get()).autoModelMigrated).toBe(true);

    await roles.save({ ...(await roles.get('custom'))!, model: 'opus' });
    expect(await migrateRolesToAuto(roles, settings)).toBe(0);
    expect((await roles.get('custom'))!.model).toBe('opus');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/main/store/migrations.test.ts`
Expected: FAIL — cannot resolve `./migrations`.

- [ ] **Step 3: Implement**

`src/shared/types.ts`: change `AppSettings` to

```ts
export interface AppSettings { claudePath: string | null; isolateUserSettings: boolean; autoModelMigrated?: boolean }
```

`src/main/store/validate.ts` `settingsSchema`: add `autoModelMigrated: z.boolean().optional(),`.

`src/main/store/migrations.ts`:

```ts
import { AUTO_MODEL } from '../../shared/types';
import type { RoleStore } from './roleStore';
import type { SettingsStore } from './settingsStore';

/** One-time: employee roles move to per-task model picking. Roles pinned afterwards stay pinned. */
export async function migrateRolesToAuto(roles: RoleStore, settings: SettingsStore): Promise<number> {
  if ((await settings.get()).autoModelMigrated) return 0;
  let changed = 0;
  for (const r of await roles.list()) {
    if (r.id === 'boss' || r.model === AUTO_MODEL) continue;
    await roles.save({ ...r, model: AUTO_MODEL });
    changed++;
  }
  await settings.save({ autoModelMigrated: true });
  return changed;
}
```

`src/main/index.ts`, right after `await service.init();`:

```ts
  await migrateRolesToAuto(new RoleStore(paths.rolesDir), settings).catch((e) => console.error('role migration failed', e));
```

with imports `import { migrateRolesToAuto } from './store/migrations';` and `import { RoleStore } from './store/roleStore';`. (A failed migration must not stop the app from starting.)

Set `"model": "auto"` in the seven non-boss files under `resources/roles/`, and in `src/renderer/src/team/roleForm.ts` `blankRole()` change `model: 'sonnet'` to `model: 'auto'`.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/main/store && npm run typecheck && npm test`
Expected: PASS. (`test/agentManager.test.ts:111` still expects `--model sonnet`; the harness stub returns sonnet, so it holds.)

- [ ] **Step 5: Commit**

```bash
git add resources/roles src/shared/types.ts src/main/store/validate.ts src/main/store/migrations.ts src/main/store/migrations.test.ts src/main/index.ts src/renderer/src/team/roleForm.ts
git commit -m "feat(roles): employee roles default to auto; migrate existing roles once

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Show the picked model in the UI

**Files:**
- Create: `src/renderer/src/tasks/modelChip.ts`
- Test: `src/renderer/src/tasks/modelChip.test.ts`
- Modify: `src/renderer/src/components/TaskBoard.tsx:37` (card meta row)
- Modify: `src/renderer/src/components/AgentDetailView.tsx:44` and `:85` (role model label, task header)
- Modify: `src/renderer/src/components/RoleEditor.tsx:54-57` (Auto option)
- Modify: `src/renderer/src/styles/app.css` (chip style)

**Interfaces:**
- Consumes: `Task.model`, `Task.modelPick`, `AUTO_MODEL` (Task 1).
- Produces:
  ```ts
  export function modelChip(task: Task): { label: string; title: string } | null;
  export function roleModelLabel(model: string): string;   // 'auto' → 'auto (per task)'
  ```

- [ ] **Step 1: Write the failing test**

`src/renderer/src/tasks/modelChip.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Task } from '../../../shared/types';
import { modelChip, roleModelLabel } from './modelChip';

const base: Task = { id: 'T-101', projectId: 'p', title: 'x', brief: '', assigneeId: 'a', createdBy: 'boss', status: 'queued', held: false, attempts: 0, branch: 'b', dependsOn: [], createdAt: '', updatedAt: '' };

describe('modelChip', () => {
  it('shows classifying while a queued task has no model', () => {
    expect(modelChip(base)).toEqual({ label: 'classifying…', title: 'Opus is picking a model for this task' });
  });
  it('labels classifier, role and fallback picks', () => {
    expect(modelChip({ ...base, model: 'opus', modelPick: { model: 'opus', size: 'large', reason: 'new subsystem', source: 'classifier' } })).toEqual({ label: 'opus · large', title: 'new subsystem' });
    expect(modelChip({ ...base, model: 'sonnet', modelPick: { model: 'sonnet', reason: 'Pinned by role', source: 'role' } })).toEqual({ label: 'sonnet · pinned', title: 'Pinned by role' });
    expect(modelChip({ ...base, model: 'sonnet', modelPick: { model: 'sonnet', reason: 'Classifier unavailable: timed out', source: 'fallback' } })).toEqual({ label: 'sonnet · fallback', title: 'Classifier unavailable: timed out' });
  });
  it('shows nothing for old tasks that never had a model', () => {
    expect(modelChip({ ...base, status: 'done' })).toBeNull();
  });
});

describe('roleModelLabel', () => {
  it('spells out auto', () => {
    expect(roleModelLabel('auto')).toBe('auto (per task)');
    expect(roleModelLabel('opus')).toBe('opus');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/renderer/src/tasks/modelChip.test.ts`
Expected: FAIL — cannot resolve `./modelChip`.

- [ ] **Step 3: Implement the helper**

`src/renderer/src/tasks/modelChip.ts`:

```ts
import { AUTO_MODEL, type Task } from '../../../shared/types';

export function modelChip(task: Task): { label: string; title: string } | null {
  if (!task.model) return task.status === 'queued' ? { label: 'classifying…', title: 'Opus is picking a model for this task' } : null;
  const p = task.modelPick;
  const tag = p?.source === 'role' ? 'pinned' : p?.source === 'fallback' ? 'fallback' : p?.size ?? 'auto';
  return { label: `${task.model} · ${tag}`, title: p?.reason ?? '' };
}

export function roleModelLabel(model: string): string {
  return model === AUTO_MODEL ? 'auto (per task)' : model;
}
```

- [ ] **Step 4: Use it in the views**

`TaskBoard.tsx` — import `modelChip`, and in the card change the `card-meta` div to:

```tsx
                    <div className="card-meta">
                      <span>{t.id}</span>
                      {(() => { const chip = modelChip(t); return chip && <span className="model-chip mono" title={chip.title}>{chip.label}</span>; })()}
                      <span style={{ marginLeft: 'auto' }}>{cardMeta(t, ws.tasks)}</span>
                    </div>
```

`AgentDetailView.tsx`:
- line 44: `<dd>claude · {role ? roleModelLabel(role.model) : '?'}</dd>` (import `roleModelLabel` from `../tasks/modelChip`).
- line 85, after the `<h3>` with `{task.title}`, add:

```tsx
                  {(() => { const chip = modelChip(task); return chip && <p className="small muted" title={chip.title}>{chip.label}{chip.title ? ` — ${chip.title}` : ''}</p>; })()}
```

`RoleEditor.tsx` — replace the `<select id="re-model">` options with:

```tsx
            {draft.id !== 'boss' && <option value={AUTO_MODEL}>Auto (Opus picks per task)</option>}
            {[...new Set([...MODELS, draft.model])].filter((m) => m !== AUTO_MODEL).map((m) => <option key={m}>{m}</option>)}
```

(import `AUTO_MODEL` from `../../../shared/types`). The Onboarding boss-model picker keeps `MODELS` unchanged.

`styles/app.css` — add (variables only, no hex):

```css
.model-chip {
  padding: 0 6px;
  border: 1px solid var(--line);
  border-radius: 4px;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  max-width: 140px;
}
```

Before using them, check that `--line` and `--ink` exist in `src/renderer/src/styles/tokens.css`. If they don't, use the token names that `.card` already uses for its border and text.

- [ ] **Step 5: Verify**

Run: `npx vitest run src/renderer/src/tasks && npm run typecheck && npm test && npm run test:e2e`
Expected: all PASS. Then take one screenshot of the task board with the fake CLI (AGENTS.md "To look at the UI" recipe, temp `AO_USER_DATA`, scratch repo). Check the chip reads `sonnet · fallback` (the fake CLI's echo reply can't be parsed, so the task falls back), with no overflow on the card.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/tasks/modelChip.ts src/renderer/src/tasks/modelChip.test.ts src/renderer/src/components/TaskBoard.tsx src/renderer/src/components/AgentDetailView.tsx src/renderer/src/components/RoleEditor.tsx src/renderer/src/styles/app.css
git commit -m "feat(ui): show each task's picked model; Auto option for roles

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Docs and final verification

**Files:**
- Modify: `AGENTS.md` (task-flow step 4, Invariants)
- Modify: `docs/superpowers/specs/2026-10-14-task-model-classifier-design.md` §3.1 (cwd)

- [ ] **Step 1: Update docs**

`AGENTS.md`, "How a task flows", step 4: before "`AgentManager.createTask` queues the task", add a sub-bullet:

```md
   - if the role's model is `auto`, `classifier.ts` runs a one-shot Opus call (outside `run()`) that sizes the task and sets `task.model` (small→haiku, medium→sonnet, large→opus, sonnet on any failure); `runnableTasks` holds the task until then;
```

In Invariants, add:

```md
- **Models:** `auto` is a role value, never a CLI flag. Employees launch with `launchModel(role.model, task.model)`; the boss maps `auto` to opus. Classification never runs inside `run()`.
```

In the spec §3.1 `createClassifier` bullet, change "`cwd` = repo root" to "`cwd` = the app's `promptDir` (no repo access needed; keeps the fake CLI from writing into the repo in tests)".

- [ ] **Step 2: Full verification**

Run: `npm run typecheck && npm test && npm run test:e2e`
Expected: all green. Paste the summary lines (test counts, e2e pass) into the handoff.

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md docs/superpowers/specs/2026-10-14-task-model-classifier-design.md
git commit -m "docs: document per-task model classification

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
