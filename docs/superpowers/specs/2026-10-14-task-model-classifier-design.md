# Task Model Classifier — Design Spec

Date: 2026-10-14
Status: Draft for review

## 1. Summary

Today every employee task runs on its role's fixed `model` (set by hand in RoleEditor). This feature adds a classifier layer: before an employee task starts, a one-shot **Opus** call reads the task's title and brief, rates its size, and the task runs on the model that fits — `small → haiku`, `medium → sonnet`, `large → opus`. Model choice becomes automatic; a role can still pin a fixed model.

## 2. Goals and non-goals

**Goals**
- Every employee task on an `auto` role gets its model from an Opus classification of that task.
- Delegation is never blocked or broken by the classifier: `assign_task` returns at once, and any classifier failure falls back to `sonnet`.
- The chosen model, size and reason are visible on the task (read-only).
- Existing installs move to `auto` without manual edits (one-time migration of employee roles).

**Non-goals**
- Overriding the chosen model per task from the UI.
- Classifying the boss (it keeps its own model, picked during onboarding).
- Re-classifying when a task gets follow-up feedback; the task keeps its model for its whole life.
- A configurable size → model table (one constant; change it in code).

## 3. Components

### 3.1 `src/main/agents/classifier.ts` (new)

- `SIZE_MODEL = { small: 'haiku', medium: 'sonnet', large: 'opus' }` and `FALLBACK_MODEL = 'sonnet'`.
- `parseClassification(text: string): { size, reason } | null` — pure. Extracts the first JSON object from the reply (tolerates ```` ``` ```` fences and surrounding prose), validates with zod (`size` ∈ small|medium|large, `reason` a non-empty string, clipped to 200 code points). Returns `null` on anything else.
- `classifierPrompt({ title, brief, roleName }): string` — pure. Defines the sizes:
  - **small**: one file or a few lines; typo, rename, config tweak, copy change, simple question.
  - **medium**: a contained feature or bug fix touching a few files, with tests.
  - **large**: cross-cutting work, new subsystem, multi-module refactor, tricky debugging, security-sensitive change.
  and asks for exactly `{"size": "...", "reason": "..."}` with a one-line reason.
- `createClassifier(deps): TaskClassifier` where `TaskClassifier = (input) => Promise<ModelPick>`:
  - Spawns one runner via the injected `createRunner` with `model: 'opus'`, `tools: []` (no tools), `isolateUserSettings` as configured, no session id / resume, `cwd` = the app's `promptDir` (no repo access needed; keeps the fake CLI from writing into the repo in tests).
  - Sends the prompt, waits for the `result` event, ends input, waits for exit.
  - 60 s timeout → stops the runner.
  - Success → `{ model: SIZE_MODEL[size], size, reason, source: 'classifier' }`.
  - Timeout, crash, error result, or unparsable reply → `{ model: FALLBACK_MODEL, reason: 'Classifier unavailable: <short cause>', source: 'fallback' }`. Never throws.

### 3.2 Data (`src/shared/types.ts`, `store/validate.ts`)

```ts
export type TaskSize = 'small' | 'medium' | 'large';
export interface ModelPick { model: string; size?: TaskSize; reason: string; source: 'classifier' | 'role' | 'fallback' }
// Task gains:
model?: string;          // undefined while classifying
modelPick?: ModelPick;
```

Both fields are optional, so existing `tasks.json` files load unchanged. Old tasks with no `model` that are not `queued` never run again, so they need nothing; old `queued` ones are classified on load (§4.3).

Role `model` accepts the literal `"auto"` (already a valid string under the current schema; the constant `AUTO_MODEL = 'auto'` lives in `shared/types.ts`).

`AppSettings` gains `autoModelMigrated?: boolean` (§3.4).

### 3.3 Built-in roles

Every file in `resources/roles/` except `boss.json` changes `"model"` to `"auto"`.

### 3.4 One-time migration of existing roles

In `ProjectService.init()`, after seeding: if `settings.autoModelMigrated` is not true, set `model: 'auto'` on every saved role whose id is not `boss`, then save `autoModelMigrated: true`. This covers built-in copies and user-made roles alike. It runs once per app-data folder; a role the user pins afterwards stays pinned.

## 4. Flow changes (`AgentManager`)

New dep: `classify: TaskClassifier`.

### 4.1 Creating a task

`createTask` inside `run()` resolves the assignee's role:
- role model is a real model → set `task.model = role.model`, `modelPick = { model, reason: 'Pinned by role', source: 'role' }`.
- role model is `auto` → leave `task.model` undefined.

After the `run()` resolves, if the task has no model, call `this.classifyTask(task)` **without awaiting it**, then `pump()` as today. `assign_task` therefore returns immediately with the task id.

### 4.2 `classifyTask(task)`

Runs **outside** `run()` so a slow Opus call never holds the state chain:
1. `pick = await this.d.classify({ title, brief, roleName })` (never throws).
2. `await this.run(...)`: if the task still exists, is still `queued`, and still has no model, set `model`/`modelPick`, save, emit `tasks-changed`. If `this.closed`, do nothing (the next `load()` re-classifies).
3. `this.pump()` (not awaited from inside any `run()`).

### 4.3 Load

After `load()` re-queues tasks, every `queued` task with no model gets `classifyTask` (not awaited).

### 4.4 Picking tasks to run (`taskRules.runnableTasks`)

A queued task with no model is **not picked**, but it still **claims its assignee** for this pass, so a later task for the same agent cannot jump ahead of it. Pure-function change, unit-tested.

### 4.5 Starting and follow-ups

- `startTask` passes `task.model` to `spawn()`; `spawn()` uses the given model instead of `role.model`. Resumed sessions switch model via `--model` + `--resume` (supported by the CLI).
- `messageAgent` reopening a task runs on that task's `model`.
- A plain question (no open task) uses `role.model`, or `FALLBACK_MODEL` when the role is `auto`.
- Defensive: if `startTask` ever sees a task without a model, it uses `FALLBACK_MODEL`.

### 4.6 Wiring

`ProjectService` builds the classifier with the same `createRunner`, `claudeBin`, `isolateUserSettings` and repo root it already passes to `AgentManager`.

## 5. UI (renderer, show-only)

- **RoleEditor**: the model select gets a first option `value="auto"` labelled "Auto (Opus picks per task)". Boss role editing is unchanged.
- **Task card** (task board): a chip after the title — `opus · large` for classifier picks, `sonnet · pinned` for role picks, `sonnet · fallback` for fallbacks, `classifying…` while `model` is undefined. The full `reason` is the chip's `title` and is also shown in the task detail. Rendered as React text only.
- **Agent log**: unchanged — `session started (<model>)` already reports the model.

## 6. Error handling

| Case | Behaviour |
| --- | --- |
| Opus call times out (60 s), crashes, or returns junk | Task runs on `sonnet`, `source: 'fallback'`, reason says why. No red banner. |
| Claude Code missing / not logged in | Classifier falls back; the task itself then fails as it would today. |
| App quits mid-classification | Result is dropped (`closed`); next `load()` re-classifies. |
| Task cancelled or held while classifying | Result is still stored if the task is `queued`; cancelled tasks are left alone. |

## 7. Testing

- `classifier.test.ts` (pure): `parseClassification` on clean JSON, fenced JSON, JSON with prose, wrong size, missing reason, garbage; `SIZE_MODEL` mapping; prompt includes title/brief.
- `classifier` with `fakeRunner`: `FAKE_CLAUDE_FIXTURE` replaying a result with classification JSON → classifier pick; `FAKE_CLAUDE_CRASH` and `FAKE_CLAUDE_HANG` (short timeout injected) → fallback; argv recorded via `FAKE_CLAUDE_ARGV_OUT` shows `--model opus` and empty `--tools`.
- `taskRules.test.ts`: unclassified task is skipped but blocks later tasks of the same agent.
- `agentManager` integration (harness with stubbed `classify`): auto role → task waits, then starts with `--model haiku`; pinned role → classifier not called, role model used; fallback path → `sonnet`; restart with a queued unclassified task → classified after `load()`; follow-up uses the task's model.
- `projectService`/migration: roles become `auto` except `boss`, flag set, second init does not touch a role pinned after migration.
- Renderer pure helper for the chip label (`tasks/modelChip.ts`) unit-tested.
- Gates: `npm run typecheck && npm test && npm run test:e2e`. `test/real` only if the user asks (costs usage).

## 8. Cost

One short Opus call per `auto` task (a few hundred tokens in, ~30 out) and a few seconds before the task starts. Small tasks moving from sonnet to haiku offsets it.
