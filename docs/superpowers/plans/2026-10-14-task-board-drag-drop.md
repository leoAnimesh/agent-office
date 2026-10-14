# Task Board Drag and Drop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drag cards between columns (merge / pause / resume / cancel), reorder the queue, and hand unstarted tasks to another employee, with drawer buttons as the non-drag path.

**Architecture:** A pure `tasks/moves.ts` decides what a drop means, shared by the board and the drawer. `AgentManager` gains `moveTask` and `reassignTask` (serialised through `run()`), `runnableTasks` honours a new `Task.order`, and `ProjectService.mergeNow` lets the user merge directly. Three new IPC channels go through the sender guard. The board uses native HTML5 drag and drop.

**Tech Stack:** Electron, TypeScript, React, Vitest, Playwright `_electron`.

**Spec:** `docs/superpowers/specs/2026-10-14-task-board-drag-drop-design.md`

## Global Constraints

- Never `await` a `run()` from inside another `run()`; `pump()` is called after the `run()` resolves.
- Expected mistakes throw `UserError` (no red banner twice).
- Every IPC handler goes through the sender guard and validates ids with `str()`.
- Reassign only `queued` tasks with `attempts === 0`; branch regenerated with `slugify`.
- Review → Done is `merge`, never `cancel`.
- Model/agent text rendered as React text only. CSS uses tokens.
- Done = `npm run typecheck && npm test && npm run test:e2e`.

## Review Focus

1. A card dropped on its own column, or a drop after the task changed state mid-drag — must be a no-op / `UserError`, never a wrong action.
2. A pending merge card plus a drag-merge of the same task — must not merge twice.
3. Reassigning a task that is still being classified (no `model` yet) — the pick stays valid for the new agent unless their role pins a model.
4. Queue order with held tasks and dependencies — order decides only among startable tasks.
5. A drag that starts on a button inside the card (none left after compact cards, but the drawer opens on click) — dragging must not open the drawer.

---

### Task 1: Move rules (`src/renderer/src/tasks/moves.ts`)

**Produces:** `type Column = 'queued' | 'working' | 'needs_help' | 'review' | 'done'`, `type MoveAction = 'merge' | 'pause' | 'resume' | 'cancel'`, `columnOf(task): Column`, `dropAction(task, to): MoveAction | null`.

- [ ] Write `moves.test.ts` covering every row of spec §3 (review→done merge; working→queued pause; held queued→working resume; queued/working/needs_help→done cancel; failed in needs_help; cancelled in done; same column, done→anything, queued(not held)→working, review→working, needs_help→review all `null`).
- [ ] Run it, watch it fail (module missing).
- [ ] Implement; run until green; commit `feat(tasks): drop rules for the task board`.

### Task 2: Queue order

**Produces:** `Task.order?: number`; `runnableTasks` sorts queued by `(order ?? Infinity, createdAt)`; `AgentManager.moveTask(id: string, beforeId: string | null): Promise<void>`; `createTask` sets `order = max(queued order) + 1` only when some queued task already has an order (else leaves it undefined so createdAt order stays).

- [ ] `taskRules.test.ts`: ordered tasks start before unordered; lower order first; unordered fall back to createdAt; held / dependency / classifying rules still hold.
- [ ] `test/moves.test.ts` (harness, `maxConcurrent: 1`, auto roles stubbed): three queued tasks for three agents while a fourth task blocks the slot… simpler: hire three, set `maxConcurrent: 1`, create a long-running first task (FAKE_CLAUDE_DELAY_MS), queue B and C, `moveTask(C, B)`, finish A, assert C launches before B. Also: moving a non-queued task → `UserError`; unknown `beforeId` → `UserError`; `createTask` after a move appends after the moved ones.
- [ ] Implement; green; commit `feat(agents): user-ordered task queue`.

### Task 3: Reassign

**Produces:** `AgentManager.reassignTask(id: string, agentRef: string): Promise<Task>`.

- [ ] Tests: reassign a queued unstarted task → new `assigneeId`, `branch` = `ao/<new slug>/<title slug>-<id>`, runs in the new agent's worktree; refused for started (`attempts > 0`), non-queued, the boss, unknown name, same agent; a role-pinned model on the new agent replaces the pick, an `auto` pick is kept.
- [ ] Implement inside `run()`, `pump()` after; green; commit `feat(agents): hand an unstarted task to another employee`.

### Task 4: Merge now + IPC

**Produces:** `ProjectService.moveTask`, `reassignTask` (notifies boss "The user handed T-104 to Byte."), `mergeNow(id)` (answers a pending card if one exists, else `manager.merge` + notify "The user merged T-101. <describeMerge>"); IPC `task:move`, `task:reassign`, `task:merge-now`; preload + `AgentOfficeApi` types.

- [ ] `test/projectService.test.ts`: mergeNow merges a review task with no card and notifies the boss; with a pending card it resolves the card (no second merge); conflict leaves the task in review.
- [ ] Implement service + handlers (sender guard, `str()`); green; commit `feat: move, reassign and merge-now IPC`.

### Task 5: Drawer buttons (non-drag path)

- [ ] `taskDetail.ts`: extend `taskActions` with `merge` (review), and add `queueNeighbours(task, tasks)` → `{ up?: string; down?: string }` (ids to pass as `beforeId`), unit-tested.
- [ ] `TaskDrawer`: Merge now (review), Move up / Move down (queued), Assign to select + Assign (queued, unstarted). Green; commit.

### Task 6: Board drag and drop

- [ ] Cards `draggable`; column drop targets using `dropAction`; `drop-ok` / `drop-no` classes; Queued insertion line (top/bottom half of a card); avatar strip for reassignable tasks; cancel confirm popover; errors to `onError`.
- [ ] Pure helper `queueDropBefore(tasks, overId, half)` → `beforeId | null`, unit-tested.
- [ ] e2e: seed a review task and two queued tasks; drag review → Done (merged), drag the second queued above the first (order changes), open drawer → Move down; Assign to.
- [ ] Green (`typecheck`, `test`, `test:e2e`), screenshots; commit `feat(tasks): drag and drop on the task board`.

### Task 7: Docs and final review

- [ ] AGENTS.md: task flow mentions user ordering and reassign; invariant line for `moveTask`/`reassignTask`.
- [ ] Final whole-branch review by a fresh reviewer; fix Critical/Important test-first.
