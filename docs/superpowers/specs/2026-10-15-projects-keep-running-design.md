# Projects Keep Running in the Background — Design Spec

Date: 2026-10-15
Status: Draft for review

## 1. Problem

`ProjectService` holds one workspace. Opening another project calls `close()` first, which stops the boss, every employee session, dev servers, the browser, devices and the terminal of the project you leave. Switching projects therefore stops all work in progress (it is re-queued and resumes only when you switch back).

## 2. Goal

Switching projects only changes which project you are looking at. Every opened project keeps running — its boss, its employees, their tasks, dev servers, browser tabs, devices and terminal — until you close that project yourself or quit the app.

Non-goals: a limit on how many projects can run at once (each running project costs what its agents use; the user decides); showing two projects side by side.

## 3. Design

### 3.1 Main process (`ProjectService`)

- `workspaces: Map<projectId, Workspace>` replaces the single `ws`; `active: Workspace | null` is the one the window shows.
- `open(repoPath)`:
  - If that project is already running, make it `active` and return its snapshot (nothing restarts).
  - Otherwise open it as today **without closing the active one**, add it to the map and make it `active`.
- `mustWs()` / `current()` / `snapshot()` / every UI call act on `active`, as today.
- `emitWs(ws, e)` forwards an event to the window only when `ws` is `active`; background projects keep working without sending their events. When the user switches to a project, the window loads its fresh snapshot (as it does today), so nothing is missed.
- `close()` (Project Settings → Close project) closes only the active project and removes it from the map; the window goes to the project list as today. `closeAll()` closes every project and is what app quit (`before-quit`) calls.
- Tool calls from bosses and employees already go to their own workspace (each has its own MCP servers, closures capture `ws`), so they keep working in the background. Merge approvals asked for by a background boss are kept (persisted as today) and show when you switch to that project.
- Terminals are already one per project and are no longer killed on switch, only on that project's close.
- Devices: each running project has its own `DeviceService`. Two projects both starting "the" Android emulator would attach to the same one; the second attaches (`startedByApp: false`) and never shuts it down — acceptable, and stated in the device tool's error if holds collide across projects (they cannot: holds are per project, the device is shared by the OS).

### 3.2 Background activity in the sidebar

- New IPC `openProjects(): Promise<{ id: string; working: number; needsYou: number }[]>` and an event on the existing workspace-event channel, `{ type: 'open-projects', projects: [...] }`, sent (throttled to once a second) whenever any project's agents or tasks change, including background ones.
  - `working` = tasks in `working`; `needsYou` = pending merge approvals + `needs_help` tasks.
- The sidebar shows, for every running project that is not the current one, a small status after its name: "2 working", and "needs you" in amber when `needsYou > 0`; a running project's dot is green instead of blue. Screen readers get the same text.

### 3.3 Renderer

- Switching projects keeps using `openProject(repoPath)`; it is now instant for a running project.
- The terminal panel is keyed by project id already; the last project's terminal keeps running in main and its backlog is shown when you come back.
- "Reopen the last project on launch" keeps working (it reopens only the last active one).

## 4. Error handling

| Case | Behaviour |
| --- | --- |
| Opening a project fails | The active project stays as it was (it is no longer closed first). |
| Closing the active project | Only that project stops; others keep running. |
| App quit | Every running project is closed and awaited (sessions, dev servers, devices the app started, terminals). |
| A background boss asks to merge | The approval waits; the sidebar shows "needs you" for that project. |

## 5. Testing

- `ProjectService` (fake CLI): open A, start a long task (`FAKE_CLAUDE_HANG`), open B → A's task is still `working` and its runner alive; switching back to A returns the same workspace without re-queuing; events from A are not forwarded while B is active; `open-projects` reports A's working task; `close()` closes only the active project; `closeAll()` closes both.
- e2e: open project A with a hanging task, open project B from the sidebar, the sidebar shows A as "1 working", switch back, the task is still working (not re-queued).
- Gates: `npm run typecheck && npm test && npm run test:e2e`.
