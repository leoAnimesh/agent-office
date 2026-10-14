# Task Board Drag and Drop — Design Spec

Date: 2026-10-14
Status: Draft for review

## 1. Summary

The task board gains drag and drop. Dropping a card runs the action its target means: move it to another column (merge, pause, resume, cancel), reorder the queue, or hand an unstarted task to another employee. Every drag has a keyboard and screen-reader equivalent in the task details panel.

## 2. Goals and non-goals

**Goals**
- Column drops run the real action, with invalid targets refused and shown as such while dragging.
- The user decides what starts next by ordering the Queued column.
- An unstarted queued task can be handed to another employee.
- Nothing is mouse-only; the boss is told about every user action that changes its plan.

**Non-goals**
- Moving a task backwards in its lifecycle (Done → anything, Review → Working, etc.).
- Reassigning a task that has started (its commits live on the first agent's branch).
- Ordering inside columns other than Queued.
- A drag-and-drop library (native HTML5 drag and drop only).

## 3. The move rules (`src/renderer/src/tasks/moves.ts`, pure)

```ts
export type Column = 'queued' | 'working' | 'needs_help' | 'review' | 'done';
export type MoveAction = 'merge' | 'pause' | 'resume' | 'cancel';
export function columnOf(task: Task): Column;             // matches COLUMNS in tasks/board.ts
export function dropAction(task: Task, to: Column): MoveAction | null;
```

| Task (column) | Dropped on | Action |
| --- | --- | --- |
| `review` | Done | `merge` |
| `working` | Queued | `pause` |
| `queued` and `held` | Working | `resume` |
| `queued`, `working`, `needs_help`, `review` | Done | `cancel` (needs confirm) |
| anything else, or the same column | — | `null` (refused) |

`needs_help` and `failed` share the Needs help column; `done` and `cancelled` share Done (as `COLUMNS` already does). Review → Done is `merge`, never `cancel`; cancelling a review task stays available from the details panel.

The board and the details panel both use these functions, so the two can never disagree.

## 4. Queue order

### 4.1 Data

`Task` gains `order?: number`. Tasks without it (all existing ones) come after ordered tasks, oldest first, so today's behaviour is unchanged until the user reorders; the first `moveTask` gives every queued task an `order`.

### 4.2 Picking (`taskRules.runnableTasks`)

Queued tasks are taken in ascending `(order ?? Infinity, createdAt)` order instead of `createdAt` only. Everything else is unchanged: held tasks are skipped, dependencies must be done, one task per agent, the concurrency limit, and the "still classifying holds its agent's place" rule.

### 4.3 Moving (`AgentManager.moveTask(id, beforeId | null)`)

- Only `queued` tasks move; `beforeId` (if given) must be another queued task, else `UserError`.
- Renumber all queued tasks 1…n in the new sequence (the moved task goes right before `beforeId`, or last when `beforeId` is null), save, emit `tasks-changed`, then `pump()` (outside the `run()` callback, as `resumeTask` does).
- `createTask` gives a new task `order = max(queued order) + 1`, so new work lands at the end.

## 5. Reassigning (`AgentManager.reassignTask(id, agentRef)`)

- Allowed only for a `queued` task with `attempts === 0` and no running session; else `UserError("Can't reassign T-101: work has started")`.
- The target must be an employee and not the current assignee.
- Sets `assigneeId`, regenerates `branch` as `ao/<slug(new agent)>/<slug(title)>-<id>` (the old branch was never created, since the task never started), resets `model`/`modelPick` only if the new agent's role pins a different model (an `auto` pick is about the task, so it is kept), saves, emits, `pump()`.
- Returns the updated task.

## 6. Merging from the board

- `ProjectService.mergeNow(taskId)`: the user is the approver, so it merges without an approval card, even when auto-merge is off.
- If a merge request for that task is pending in the `ApprovalBroker`, it is resolved as approved (the card disappears) instead of merging twice.
- Otherwise it calls `manager.merge(taskId)` directly.
- The boss is told through `BossSession.notify`: `The user merged T-101.` plus the outcome text from `describeMerge` (merged / conflict files / blocked reason).
- A failed merge (conflict, dirty checkout) surfaces as the usual error banner; the task stays in Review.

## 7. IPC (`src/shared/ipc.ts`)

New channels, each through the sender guard with validated arguments (`str()` for ids):

| Channel | Args | Returns |
| --- | --- | --- |
| `task:move` | `id, beforeId \| null` | `void` |
| `task:reassign` | `id, agent` | `void` |
| `task:merge-now` | `id` | `void` |

Existing `task:pause`, `task:resume`, `task:cancel` cover the other actions.

The boss is notified for reassign (`The user handed T-104 to Byte.`) and merge; reorder is not announced (it changes nothing the boss acts on).

## 8. Board UI (`TaskBoard.tsx`)

- Every card is `draggable`. `dataTransfer` carries the task id.
- While dragging:
  - columns where `dropAction` is non-null highlight (`drop-ok`); others dim (`drop-no`) and refuse the drop;
  - in Queued, a 3 px insertion line shows where the card will land between cards (drop on the top/bottom half of a card = before/after it);
  - if the dragged task is reassignable, an **avatar strip** appears above the Queued column: one avatar button per other employee (`Hand to Byte`), each a drop target.
- Dropping:
  - `merge`, `pause`, `resume` run at once;
  - `cancel` opens a small confirm popover anchored to the card ("Cancel T-104? · Cancel task · Keep") — the same component as the Team menu's popover;
  - a drop inside Queued calls `moveTask`;
  - a drop on an avatar calls `reassignTask`.
- Errors go to the existing error banner; the board re-renders from the next `tasks-changed`, so a refused or failed move simply leaves the card where it was.
- Cards are already openable by click; a drag never opens the drawer.
- `prefers-reduced-motion`: no drag animations (highlights only).

## 9. Details panel (`TaskDrawer.tsx`) — the non-drag way

- Review task: **Merge now** button (primary).
- Queued task: **Move up** / **Move down** buttons (disabled at the ends) calling `moveTask`.
- Queued, unstarted task: **Assign to** `<select>` of other employees + **Assign** button.
- Existing Pause / Resume / Cancel task stay.
- All are labelled buttons/selects; results announce through the existing `role="status"` note pattern.

## 10. Error handling

| Case | Behaviour |
| --- | --- |
| Invalid drop | Refused in the UI; the main process re-checks and throws `UserError`. |
| Task changed state mid-drag (e.g. finished) | Main re-checks; `UserError` banner; board refreshes. |
| Reassign target is the boss or unknown | `UserError`. |
| Merge conflict / dirty checkout | Existing merge errors, banner, task stays in Review, boss told. |
| Move of a non-queued task | `UserError`. |

## 11. Testing

- `moves.test.ts`: every row of §3, including shared columns and refusals.
- `taskRules.test.ts`: `order` beats `createdAt`; tasks without `order` fall back to `createdAt`; holds, dependencies and the classifying rule still apply.
- Manager integration (`test/moves.test.ts`, harness):
  - `moveTask` renumbers and changes which task starts first;
  - `createTask` appends to the end;
  - `reassignTask` changes assignee and branch, refuses started tasks, the boss and self;
  - the reassigned task runs in the new agent's worktree.
- `projectService` test: `mergeNow` merges without a card, resolves a pending card instead of double-merging, notifies the boss; a conflict leaves the task in Review.
- IPC guard: the three channels validate their arguments.
- e2e: drag a review card to Done and see it merged; drag a queued card above another; open the drawer and use Move up / Assign to without a mouse.
- Gates: `npm run typecheck && npm test && npm run test:e2e`.
