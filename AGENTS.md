# AGENTS.md

This guide is for coding agents working in AgentOffice, an open-source Electron desktop app (macOS, Windows, Linux; MIT licence). In the app, a **boss** Claude Code agent hires **employee** agents, delegates tasks to them and reviews their work, all shown as a pixel-art office. This file is the only source of agent instructions; `CLAUDE.md` imports it.

## Commands

```sh
npm install                 # also downloads the Electron binary (postinstall)
npm run dev                 # electron-vite dev: main + preload + renderer with HMR
npm test                    # Vitest: unit + integration (fake claude CLI, temp git repos), ~7s
npx vitest run test/agentManager.test.ts          # one file
npx vitest run -t "merges a reviewed task"         # one test by name
npm run typecheck           # tsc for node side (tsconfig.json) and renderer (tsconfig.web.json)
npm run build               # electron-vite build → out/
npm run test:e2e            # build + Playwright _electron smoke test (e2e/), uses the fake CLI
npm run dist                # build + electron-builder installers → release/ (dmg / nsis / AppImage+deb)
npm run pack                # unpacked app only (what CI checks)
npm run icon                # regenerate build/icon.png from the pixel grid in scripts/make-icon.mjs
AO_REAL_CLAUDE=1 npx vitest run test/real          # real end-to-end with your Claude Code; SPENDS USAGE
```

- Before you call a change done, run `npm run typecheck && npm test`. For UI or main-process wiring changes, also run `npm run test:e2e`.
- `test/real/` is skipped unless `AO_REAL_CLAUDE=1` is set. It drives real `claude` (boss on sonnet, employee on haiku) in a throwaway repo. Run it only when the boss, MCP or runner flow changes, and only once, since it costs money.
- CI (`.github/workflows/ci.yml`) runs on ubuntu, macos and windows: typecheck, test, build, Playwright (`xvfb-run` on Linux) and `electron-builder --dir`. All three must stay green. Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds installers on all three OSes and attaches them to a **draft** GitHub release.

## Architecture

There are three processes and one rule: **all logic, files, git and child processes live in the main process.** The renderer is a view, and it talks to main only through the typed IPC in `src/shared/ipc.ts`.

```
src/shared/      types.ts (domain + IPC payload types), ipc.ts (channel names + AgentOfficeApi)
src/main/        Electron main (Node). Plain TS modules with injected deps, unit-testable without Electron
  index.ts         window, IPC handlers (sender-guarded), settings, AO_* dev hooks, clean quit
  claude/          ClaudeRunner (spawns `claude -p` stream-json), streamParser, status (desk bubble),
                   args (CLI flags), locate (find claude on each OS), shellPath (GUI PATH fix), killTree
  agents/          AgentManager (hire/fire/tasks/queue/merge/message), taskRules (state machine + queue),
                   prompt (role prompt + skills), bossTools (zod-validated MCP tool defs)
  boss/            BossSession: the boss's long-lived claude session ↔ chat entries
  mcp/             McpHost: Streamable-HTTP MCP server on 127.0.0.1 with a bearer token
  git/             worktrees.ts: git(), slugify, WorktreeManager (prepare/commitAll/diffStat/merge/remove)
  store/           JSON stores (atomic writes), roles, skills, settings, zod validation
  workspace/       ProjectService (one open project: wires everything, emits WorkspaceEvents), ApprovalBroker,
                   newProject (create a repo from scratch: name validation, git init, first commit)
src/preload/     contextBridge → window.agentOffice (AgentOfficeApi)
src/renderer/    React app: state.ts (reducer + view routing), components/, sprites/, office/, agent/,
                 tasks/, team/, chat/ (pure helpers next to their views), styles/ (tokens, app, office)
resources/       built-in roles/*.json and skills/*.md, copied into app data on first launch (user-editable after)
test/            integration tests, fake-claude/, fixtures/, helpers/ (repo, runner, manager harness), real/
e2e/             Playwright smoke test of the built app
docs/superpowers specs/ (design spec) and plans/ (implementation plans 1–3)
```

**How a task flows:**
1. The user chats in `BossChat`, and the message goes over IPC to `ProjectService.sendToBoss`.
2. `BossSession` writes it to the boss's `claude` stdin.
3. The boss calls MCP tools on `McpHost` (`mcp__agentoffice__assign_task`, …), which run `bossTools`, which call `AgentManager`.
4. `AgentManager.createTask` queues the task, and `pump()` starts it:
   - if the role's model is `auto`, `classifier.ts` first runs a one-shot Opus call (outside `run()`) that sizes the task and sets `task.model` (small→haiku, medium→sonnet, large→opus, sonnet on any failure); `runnableTasks` holds the task until then;
   - `WorktreeManager.prepare` creates or checks out `.agentoffice/wt/<agent>` on branch `ao/<agent>/<slug>-<task id>`;
   - a `ClaudeRunner` spawns `claude -p --input-format stream-json --output-format stream-json …` in that worktree.
5. `StreamParser` turns the stream into `RunnerEvent`s, which update the agent's status and bubble, go to the log, and reach the UI as `agent-event`.
6. When the task finishes:
   - leftover changes are committed and the diff stat is computed;
   - the task moves to `review` (or `needs_help`);
   - `task-finished` fires, and BossSession sends `[AgentOffice] T-101 by Pixel finished…` to the boss.
7. The boss calls `request_merge`, and the user approves a card in the chat (unless auto-merge is on). `WorktreeManager.merge` then merges into the base branch, and the boss gets the outcome.

**Where data lives:**
- App data is under Electron `userData` (`dataPaths()` in `store/paths.ts`): `settings.json`, `roles/`, `skills/`, `prompts/`, and `projects/<id>/{project.json, agents.json, tasks.json, chat.jsonl, logs/<agentId>.jsonl, pending-merges.json, mcp.json}`.
- Inside the user's repo, the only thing AgentOffice adds is `.agentoffice/`. It is excluded via `.git/info/exclude`, never via `.gitignore`.

## Invariants: don't break these

- **AgentManager serializes every state change through `run()`.**
  - Never `await` a `run()` call from inside another `run()` callback, because that deadlocks. The exit handler calls `this.pump()` without awaiting it for this reason.
  - Runner events are queued into the chain.
  - Throw `UserError` for expected mistakes (unknown name, duplicate, busy, closed). `run()` does not broadcast those as app errors, so the UI doesn't show a red banner twice.
- **Shutdown and stop wait for processes to exit** (`waitForExit`). Windows keeps a running process's cwd locked. After `shutdown()`, `closed` is set: exits no longer change task state, and nothing new starts, so the next `load()` re-queues the task.
- **Finishing a task:** commit and diff *first*, then set the status, so a `review` task always has its `diffStat`.
- **Follow-up messages:** `messageAgent` reopens the agent's newest `review`/`needs_help` task and runs the follow-up as part of that task, so its changes are committed and re-reported. Only when there's no open task is the message a plain question (`agent-replied`).
- **Sessions:**
  - Employees resume their Claude session (`--resume`) across tasks.
  - If a resume dies before `init`, forget the session and start fresh. The "continue" message always repeats the brief.
- **Merging:**
  - Refuse when the checkout is on another branch, is a detached HEAD, or has uncommitted changes to tracked files. Untracked files are fine.
  - On a conflict, run `merge --abort` and report the files.
  - Approvals are asynchronous and persisted. `request_merge` returns at once; the boss is told the result later.
- **Boss isolation:** the boss gets `--tools Read Grep Glob` (no editing) plus `--allowedTools mcp__agentoffice`. Every agent session runs with `--setting-sources project,local`, so the user's global hooks and plugins stay out (configurable in Settings).
- **Names:** worktree and branch names come from `slugify(name)`. `hire()` rejects names whose slug collides with an existing employee's, because two agents must never share a worktree.
- **Firing** is refused while the agent has open work. Otherwise the app commits leftovers, removes the worktree, and keeps the branches.
- **Models:** `auto` is a role value, never a CLI flag. Employees launch with `launchModel(role.model, task.model)`; the boss maps `auto` to opus. Classification never runs inside `run()`.

## Cross-platform rules

- Spawn with an args array via `cross-spawn`; never use a shell string. Long text goes through files (`--append-system-prompt-file`), not argv, because of Windows' command-line limit.
- POSIX children are spawned `detached` and killed with `process.kill(-pid)`. On Windows use `taskkill /T /F` (`killTree`).
- Build every path with `node:path`. Parse streams with `\r\n` in mind. Atomic renames retry on `EPERM`/`EBUSY`/`EACCES`.
- To find `claude`, `locate.ts` checks `PATH` (with `PATHEXT` on Windows) and then known install folders. On macOS and Linux, GUI launches first merge in the login shell's PATH (`fixGuiPath`).
- Tests must pass on Windows. Test repos set `core.autocrlf=false`, and cleanup uses `fs.rm(…, { maxRetries: 5, retryDelay: 200 })`.

## Security rules

- Renderer settings: `contextIsolation`, `sandbox`, no `nodeIntegration`, a strict CSP (fonts are bundled through `@fontsource`, never loaded from Google), and new windows and navigation are denied.
- Every IPC handler goes through the sender guard (`ipcGuard.ts`). It validates its arguments (`str()`, the zod schemas in `store/validate.ts`) and never trusts the renderer.
- Model and agent text is rendered only as React text. Never use `dangerouslySetInnerHTML`.
- The MCP host listens only on `127.0.0.1`, uses a random bearer token compared in constant time, and caps the body size. Its `mcp.json` is mode 0600.
- `worktreeFor()` only opens paths inside `<repo>/.agentoffice/wt/`.
- The `AO_*` dev hooks and `ELECTRON_RENDERER_URL` are read only by `testOverrides.ts`, and **only when not packaged**. Packaged builds also turn on Electron fuses (no `RUN_AS_NODE`, no `NODE_OPTIONS`, no inspect, app loaded only from the asar).

## Testing conventions

- TDD: write the test, watch it fail for the right reason, then implement. Keep pure logic in small modules next to their feature (`office/model.ts`, `tasks/board.ts`, …) so it can be tested without React.
- `test/fake-claude/fake-claude.mjs` stands in for the CLI. Use it through `test/helpers/runner.ts` (`fakeRunner`) or `test/helpers/manager.ts` (`harness()`, `waitFor`, `finished`). It is controlled by env vars:
  - `FAKE_CLAUDE_FIXTURE`: replay a recorded stream-json file;
  - `FAKE_CLAUDE_FILE`: append a line to a file in the cwd, to create a diff (the boss, started with `--mcp-config`, never writes);
  - `FAKE_CLAUDE_HANG`: never send a result;
  - `FAKE_CLAUDE_CRASH`: exit 3 with stderr;
  - `FAKE_CLAUDE_FAIL`: send an error result;
  - `FAKE_CLAUDE_RESUME_FAIL`: fail when `--resume` is used;
  - `FAKE_CLAUDE_TRAP_TERM`: ignore SIGTERM;
  - `FAKE_CLAUDE_DELAY_MS`: pause between fixture lines;
  - `FAKE_CLAUDE_ARGV_OUT`: record each launch's argv and cwd.
  - `FAKE_CLAUDE_RESULT`: use this exact text as the success result (e.g. classifier JSON).
- Dev and E2E hooks, read only when unpackaged:
  - `AO_USER_DATA`: app data folder;
  - `AO_CLAUDE_BIN` + `AO_CLAUDE_ARGS`: e.g. `node` + `["test/fake-claude/fake-claude.mjs"]`;
  - `AO_CLAUDE_MISSING=1`: pretend Claude Code isn't installed;
  - `AO_E2E_PICK_FOLDER`: the folder the picker returns.
- To look at the UI without touching real projects:
  1. Build.
  2. Create a scratch git repo in a temp dir.
  3. Drive the app with Playwright `_electron`, pointing `AO_USER_DATA` at a temp folder and using the fake CLI, and take screenshots.

  Never open the user's real repositories through the fake CLI, because it creates real `ao/*` branches. A packaged build can't be driven by Playwright (fuses disable the inspector); check it by launching it directly.

## UI conventions

- The design source is the Claude Design canvas: https://claude.ai/artifact/YZ2SXE3nzJBD7R3AuSyE9G. The palette and fonts are tokens in `src/renderer/src/styles/tokens.css`; use the variables, not raw hex values.
- Sprites are SVG rects (`sprites/DeskSprite.tsx`, `Avatar.tsx`). Animations are CSS classes `is-<status>` in `office.css`, and they stop under `prefers-reduced-motion`.
- Accessibility: every control is a real `<button>`, `<a>`, `<input>`, `<select>` or `<textarea>` with an accessible name, and text contrast is at least 4.5:1. Clip user text with `clip()`, which counts code points, and give flex children `min-width: 0` so long names never overflow.

## Git, commits and workflow

- Commits use Conventional Commit messages (`feat(ui): …`, `fix: …`, `docs: …`, `test: …`, `build: …`). End each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and each PR description with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Commit identity is set in this repo (`leoAnimesh <mondalarup808@gmail.com>`), and pushes authenticate as `leoAnimesh` through a repo-local credential helper. Never commit as the work account, and don't change the global git config. For `gh`, use `GH_TOKEN=$(gh auth token --user leoAnimesh) gh …`.
- Work on a feature branch and open a PR so CI runs on all three OSes. Don't push straight to `main` except for docs.
- Bigger features follow the spec → plan → build flow: specs go in `docs/superpowers/specs/`, plans in `docs/superpowers/plans/`. Read the spec before changing core behaviour.
- `.superpowers/`, `out/`, `release/`, `test-results/` and `node_modules/` are scratch or build output and are gitignored. Never commit them.

## Known gaps (deferred)

- Accessibility polish: the streaming log uses `aria-live`, log timestamps are about 3.9:1 contrast, focus doesn't move to the fire confirmation, and the colour inputs are labelled only "hair", "shirt" and "skin".
- The IPC sender guard accepts any `file://` frame and prefix-matches the dev URL.
- `saveRole` can overwrite a built-in role id if the renderer's role list hasn't loaded yet.
- Validation messages show internal key names.
- There's no back-off when a crashing boss is restarted.
- Only the Claude Code CLI is supported. Codex would plug in behind the `AgentRunner` interface (`src/main/claude/runner.ts`).
