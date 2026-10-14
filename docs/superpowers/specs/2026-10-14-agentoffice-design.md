# AgentOffice — Design Spec

Date: 2026-10-14
Status: Draft for review
UI design: https://claude.ai/artifact/YZ2SXE3nzJBD7R3AuSyE9G (Office, Agent detail, Task board, Team & role editor, First launch)

## 1. Summary

AgentOffice is an open-source desktop app (Electron) that runs a team of AI coding agents on top of the user's local **Claude Code CLI**. Each project has one **Boss** agent and any number of **Employee** agents created from configurable **Role templates** (Frontend Engineer, Backend Engineer, QA, …). The user talks to the Boss; the Boss hires employees and delegates tasks to them through tools the app provides. Every agent works in its own git worktree. The UI is a pixel-art office where each agent sits at a desk and animates according to what its Claude Code session is doing.

## 2. Goals and non-goals

**Goals (v1)**
- Run Boss and Employees as real `claude` CLI processes using the user's existing login (no API keys).
- Boss delegates via MCP tools hosted by the app; results flow back to the Boss automatically.
- Role templates with editable system prompt, skills (markdown files), model, permission mode and allowed tools.
- Isolation: one git worktree + branch per employee; merges into the project branch only with user approval (default).
- Live visibility: office view with animated sprites, per-agent live log, task board.
- Open source (MIT). Cross-platform: macOS, Windows and Linux are all first-class targets, built and tested in CI (see §9a).

**Non-goals (v1)**
- Codex or other CLIs (the runner is behind an interface so they can be added later).
- Cloud sync, accounts, multi-user, remote execution.
- Cross-project dashboard; agents talking to each other directly (all coordination goes through the Boss).

## 3. Architecture

```
┌──────────── Electron main process (Node) ────────────┐
│ ProjectService   RoleStore   SkillStore   TaskStore   │
│ AgentManager ── ClaudeRunner (spawn + stream parser)  │
│ WorktreeManager (git)                                 │
│ McpHost (HTTP MCP server on 127.0.0.1, per-project    │
│          bearer token) ── tools for the Boss          │
│ IPC bridge (typed channels)                           │
└───────────────▲───────────────────────────────────────┘
                │ contextBridge / IPC events
┌───────────────┴──────── Renderer (React) ─────────────┐
│ Onboarding · Office · BossChat · AgentDetail          │
│ TaskBoard · Team/RoleEditor · Settings                │
└───────────────────────────────────────────────────────┘
```

- **Main process** owns all child processes, files, git and the MCP server. The renderer never touches the filesystem or spawns processes.
- **Renderer** is a pure view: it receives state snapshots and incremental events over IPC and sends user intents (send message, hire, pause, approve merge…).

### Tech stack
Electron + electron-vite, React 18, TypeScript (strict), Zustand for renderer state, `@modelcontextprotocol/sdk` for the MCP server, `simple-git` or direct `git` calls via `execFile`, Vitest for unit tests, Playwright (`_electron`) for a smoke test, electron-builder for packaging. npm as package manager.

## 4. Domain model

```ts
type AgentStatus = 'idle' | 'thinking' | 'working' | 'waiting' | 'done' | 'error' | 'paused';

interface Role {            // ~/.agentoffice/roles/<id>.json
  id: string; name: string; blurb: string;
  systemPrompt: string;
  skills: string[];         // skill ids
  model: 'opus' | 'sonnet' | 'haiku' | string;
  permissionMode: 'acceptEdits' | 'default' | 'plan' | 'bypassPermissions';
  allowedTools: string[];   // e.g. ["Read","Edit","Write","Bash","Grep"]
  look: { hair: string; shirt: string; skin: string };
}

interface Skill { id: string; name: string; description: string; body: string } // ~/.agentoffice/skills/<id>.md (front-matter + body)

interface Agent {
  id: string; projectId: string; name: string; roleId: string;
  kind: 'boss' | 'employee';
  sessionId?: string;       // Claude Code session id, reused with --resume
  worktreePath?: string;    // employees only
  status: AgentStatus; bubble: string;   // derived from the live stream
}

interface Task {
  id: string;               // T-101…
  projectId: string; title: string; brief: string;
  assigneeId: string; createdBy: 'boss' | 'user';
  status: 'queued' | 'working' | 'needs_help' | 'review' | 'done' | 'failed' | 'cancelled';
  branch: string;           // ao/<agent>/<slug>
  dependsOn: string[];
  resultSummary?: string; diffStat?: { path: string; add: number; del: number }[];
  createdAt: string; updatedAt: string;
}

interface Project {
  id: string; name: string; repoPath: string; baseBranch: string;
  bossId: string; maxConcurrent: number;   // default 4
  bossCanHire: boolean; autoMerge: boolean; // defaults: true, false
}
```

### Persistence
- Global (app data dir, see §9a; shown here as `~/.agentoffice`): `{settings.json, roles/, skills/}`. Built-in role presets and skills are copied there on first launch and are then user-editable.
- Per project: `~/.agentoffice/projects/<projectId>/{project.json, agents.json, tasks.json, chat.jsonl, logs/<agentId>.jsonl}`.
- Writes are atomic (write temp file, rename). No database in v1.
- Worktrees live in `<repo>/.agentoffice/wt/<agent-name>`; `.agentoffice/` is added to `<repo>/.git/info/exclude` so it never shows up in the user's git status.

## 5. Running Claude Code

### ClaudeRunner
One class wraps one `claude` child process:

```
claude -p
  --input-format stream-json --output-format stream-json --verbose
  --model <role.model>
  --permission-mode <role.permissionMode>
  --allowedTools <role.allowedTools…>
  --append-system-prompt <rendered role prompt + skills + team context>
  [--mcp-config <tmp json> --strict-mcp-config]   # boss only
  [--session-id <uuid> | --resume <sessionId>]
cwd = repo root (boss) or worktree (employee)
```

- Long-lived: stdin stays open; the app writes user messages as stream-json lines. This lets the user (or the app on the Boss's behalf) send follow-ups into a running session.
- `StreamParser` turns stdout lines into typed events: `init(sessionId)`, `assistantText`, `toolUse(name, input)`, `toolResult`, `result(success|error, text, usage)`. Unknown lines are logged and ignored.
- Every event is appended to the agent's `logs/<agentId>.jsonl` and pushed to the renderer.
- **Status derivation:** `toolUse` → `working` (bubble: "Editing ThemeToggle.tsx", "Running npm test", …); `assistantText` streaming → `thinking`; `result` → `done` or `error`; no live process → `idle`; task queued behind a dependency → `waiting`.
- The `claude` binary path is auto-detected (`which claude`, common install paths) and overridable in Settings. `claude --version` is checked on startup; missing or logged-out CLI shows a blocking setup screen.
- An `AgentRunner` interface (`start`, `send`, `stop`, `onEvent`) sits above ClaudeRunner so a Codex runner can be added later without touching AgentManager.

### Boss
- Starts when the project opens (or on first user message), with cwd = repo root, permissions limited to read-only tools plus the AgentOffice MCP tools (the Boss plans and reviews; employees write code).
- System prompt adds: the team roster, available roles, the task rules ("delegate implementation, review results, keep tasks small, state dependencies").

### Employees
- One process per task. A follow-up task to the same employee uses `--resume <sessionId>` so the employee keeps its context.
- Before start: WorktreeManager ensures the worktree exists and checks out `ao/<agent>/<task-slug>` from the project's base branch (or from the branch of a dependency if `dependsOn` is set).
- When the process emits `result`: task → `review` (success) or `needs_help` (error); the app computes `git diff --numstat` vs the base branch, stores the summary, and injects a message into the Boss's stdin: `[AgentOffice] T-108 by Pixel finished (success). Summary: … Files: …`.

### Concurrency and lifecycle
- At most `project.maxConcurrent` employee processes run at once; extra tasks wait in `queued`. Tasks whose `dependsOn` are not `done` also stay queued.
- Pause = SIGINT the process and mark the task `queued` (it resumes with `--resume`). Stop/cancel = kill the process tree, task `cancelled`.
- App quit kills all child process trees (cross-platform tree kill, see §9a). On launch, tasks left in `working` are reset to `queued`.

## 6. MCP tools (served to the Boss)

The app runs one Streamable-HTTP MCP server on `127.0.0.1:<random port>`, per-project bearer token in the generated `--mcp-config` file. Tools:

| Tool | Input | Effect |
|---|---|---|
| `list_team` | – | Employees with role, status, current task |
| `list_roles` | – | Role templates available to hire |
| `hire` | `role_id, name?` | Creates an employee (rejected if `bossCanHire=false`; then the user is asked in the UI) |
| `assign_task` | `agent, title, brief, depends_on?` | Creates a task, queues/starts it; returns task id |
| `get_task` | `task_id` | Status, summary, diff stat |
| `list_tasks` | `status?` | Tasks in this project |
| `message_agent` | `agent, text` | Sends a follow-up into that employee's session (resumes it if idle) |
| `request_merge` | `task_id` | Merges the task branch into the base branch — with `autoMerge=false` the UI shows an approval card first; returns merged / rejected / conflict |
| `cancel_task` | `task_id` | Stops the task |
| `report_to_user` | `text` | Posts a highlighted message in the Boss chat |

Tool results are plain JSON text. All tool calls are also displayed as cards in the Boss chat.

## 7. Skills

- A skill is a markdown file with front-matter (`name`, `description`). Roles reference skills by id.
- At spawn time the role prompt is rendered as: role system prompt → "## Skills" → each enabled skill's body → "## Team context" (agent name, boss name, branch, rules: stay in your worktree, run relevant tests, end with a ≤5-line summary).
- v1 injects skills via `--append-system-prompt`. (Copying them into `.claude/skills/` in the worktree is a possible later enhancement.)

## 8. UI (matches the design canvas)

- **First launch:** detect the CLI → pick a git repo folder → hire the boss (name, model, "boss can hire").
- **Office:** a pixel-art floor; the Boss's desk sits in the corner office next to a plan whiteboard (open tasks); employees sit in a grid of desks with an "Empty desk · hire" slot. Each desk shows a speech bubble and a status dot; sprites animate for working/thinking/waiting/error (CSS keyframes, disabled with `prefers-reduced-motion`). Clicking a desk opens Agent detail. The Boss chat is on the right: user and boss messages, tool-call cards, task-finished events with "Review diff", and merge approval cards.
- **Agent detail:** sprite, metadata (model, permission mode, worktree, branch), skills, actions (Message, Pause, Open worktree, Stop), live log, current task, changed files.
- **Task board:** Queued / Working / Needs help / Review / Done; filter by assignee; "New task" goes to the Boss as a user message.
- **Team & roles:** role library, current team, role editor (look, model, permission mode, tools, system prompt, skills), Hire.
- **Settings:** Claude binary path, max concurrent agents, defaults for permission mode and auto-merge.
- Sprites are drawn in code (SVG rects), using the canvas palette: night `#14151F`, amber `#F5B942`, teal `#52D1BE`, blue `#7AA2FF`, green `#8BD47A`, red `#FF7A6B`; fonts Pixelify Sans, IBM Plex Sans, IBM Plex Mono (bundled locally, OFL).

## 9. Errors and safety

- CLI missing, not executable, or logged out → setup screen with the exact command to fix it.
- Process crash or non-zero exit → task `needs_help`, last stderr lines shown, Boss is notified.
- Merge conflicts → `request_merge` returns `conflict` with the file list; the branch is left alone; the Boss can ask the employee to rebase.
- Employees run with `acceptEdits` by default and only the role's allowed tools; `bypassPermissions` is shown with a warning in the role editor. Employees are told to stay in their worktree, but this is guidance, not a sandbox — the README states that clearly.
- MCP server binds to 127.0.0.1 only and requires the bearer token.
- Renderer runs with `contextIsolation: true`, `nodeIntegration: false`, and a strict CSP.

## 9a. Cross-platform

- **Targets:** macOS (arm64 + x64), Windows 10/11 (x64, arm64), Linux (x64; AppImage + deb). Packaged with electron-builder: `dmg`, `nsis`, `AppImage`/`deb`.
- **Finding the CLI:** search `PATH` with platform rules (`which` on POSIX, `where` on Windows, honour `PATHEXT` so `claude.cmd` / `claude.exe` resolve), then known install locations (`~/.local/bin/claude`, `~/.claude/local/claude`, npm global bin, `%APPDATA%\npm\claude.cmd`, `%LOCALAPPDATA%\Programs\claude\claude.exe`). GUI apps on macOS/Linux don't inherit the login shell `PATH`, so on startup the app reads it once from the user's login shell (`$SHELL -ilc 'echo $PATH'`) and merges it.
- **Spawning:** `child_process.spawn` with an args array, never a shell string. On Windows a `.cmd` shim is launched through `cmd.exe /d /s /c` with args escaped by a single helper; `.exe` is spawned directly. Long prompts are passed via `--append-system-prompt-file`/temp files instead of argv, to stay under Windows' command-line length limit.
- **Process trees:** POSIX spawns in a new process group (`detached: true`) and kills with `process.kill(-pid)`; Windows uses `taskkill /pid <pid> /T /F`. Pause on Windows (no SIGINT to a child) = graceful stop then `--resume`.
- **Paths & files:** all paths built with `path`/`os.homedir()`; app data under Electron's `app.getPath('userData')` instead of a hard-coded `~/.agentoffice` (macOS `~/Library/Application Support/AgentOffice`, Windows `%APPDATA%\AgentOffice`, Linux `~/.config/AgentOffice`). Stream parsing tolerates `\r\n`. Git is called with `-c core.longpaths=true` on Windows.
- **UI:** standard native window chrome on each platform; keyboard shortcuts use `CmdOrCtrl`.
- **CI:** GitHub Actions matrix `macos-latest`, `windows-latest`, `ubuntu-latest` running typecheck, unit + integration tests (with the fake claude binary, which ships as a Node script plus `.cmd` shim) and the Electron smoke test (`xvfb-run` on Linux). Release workflow builds installers on all three.

## 10. Testing

- **Unit (Vitest):** StreamParser (recorded stream-json fixtures), status/bubble derivation, TaskStore state machine and dependency queueing, WorktreeManager (against a temp git repo), MCP tool handlers (in-memory), prompt rendering, atomic JSON store.
- **Integration:** AgentManager with a **fake `claude` binary** (a Node script that replays fixture stream-json and echoes stdin) — covers spawn → events → task completion → boss notification, pause/resume, concurrency limit.
- **E2E smoke (Playwright + Electron):** launch with the fake binary, finish onboarding against a temp repo, send a boss message, see a desk change state.
- CI: GitHub Actions matrix on macOS, Windows and Linux running lint, typecheck, unit + integration + smoke tests.

## 11. Repository

- `github.com/leoAnimesh/agent-office`, MIT license, README with screenshots from the design, CONTRIBUTING, issue templates.
- Layout:
```
src/main/        services (runner, agents, tasks, worktrees, mcp, stores, ipc)
src/preload/     typed bridge
src/renderer/    React app (screens, office sprites, state)
src/shared/      domain types + IPC contract
resources/       built-in roles + skills, fonts
test/            fixtures, fake-claude, e2e
docs/            specs and plans
```

## 12. Milestones

1. Scaffold: Electron + React + TS, lint, test, CI, shared types, JSON stores.
2. ClaudeRunner + StreamParser + fake claude; Agent detail log renders a real session.
3. Worktrees + TaskStore + AgentManager (queue, concurrency, completion).
4. MCP host + Boss session + Boss chat; end-to-end delegation.
5. Office view with sprites, Task board, Team/role editor, onboarding, settings.
6. Merge approvals, polish, packaging (dmg / nsis / AppImage+deb via a release workflow on all three OSes), README.
