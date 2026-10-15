# Project Terminal — Design Spec

Date: 2026-10-15
Status: Draft for review

## 1. Summary

Each open project gets a real terminal: a resizable panel at the bottom of the project area running the user's own shell in the project folder. It is a full PTY (colours, resize, interactive programs), drawn with xterm.js in the renderer and backed by `node-pty` in the main process.

## 2. Goals and non-goals

**Goals**
- A full interactive shell in the project folder, one keystroke away (header button or Ctrl+\`).
- The user's normal environment: login shell on macOS/Linux, PowerShell on Windows.
- The session survives tab and project switches; it ends cleanly when the project closes or the app quits.
- Ships in the installers for macOS (arm64 + x64), Windows and Linux, with CI green on all three.

**Non-goals**
- Several terminals or tabs per project.
- A terminal outside a project (no project open → no terminal).
- Giving the boss or employees access to this terminal.
- Persisting scrollback across app restarts.

## 3. Architecture

```
renderer (xterm.js)  ──IPC──▶  main: TerminalService ──▶ node-pty ──▶ $SHELL -l  (cwd = project root)
      ▲                                     │
      └──────── terminal:data / exit events ┘
```

### 3.1 Main process: `src/main/terminal/terminalService.ts`

- `TerminalService` keeps at most one session per project id: `{ pty, cols, rows, buffer }`.
- `open(projectId, cwd, cols, rows)`: if a session exists, return its recent output (the last 256 KB kept in `buffer`) so the panel can redraw; otherwise spawn.
- Spawn:
  - macOS/Linux: `process.env.SHELL || '/bin/bash'` with `['-l']`; Windows: `powershell.exe` (`-NoLogo`).
  - `cwd` = the open project's repo root, resolved by `ProjectService`, never a path from the renderer.
  - `env` = `process.env` (already GUI-PATH-fixed by `fixGuiPath`) plus `TERM=xterm-256color`, `COLORTERM=truecolor`.
  - `name: 'xterm-256color'`.
- `write(projectId, data)`, `resize(projectId, cols, rows)` (clamped 2–500 × 1–300), `kill(projectId)`, `killAll()`.
- Output: emitted as `{ projectId, data }` batched every ≤ 16 ms (one IPC message per frame, not per chunk) and appended to the ring `buffer`.
- Exit: emits `{ projectId, exitCode }` and forgets the session.
- Killing: `pty.kill()`, then on Windows `killTree(pid)` as agents do, so no orphaned `conhost`/child processes keep the folder locked. `killAll()` is awaited on quit and in `ProjectService.close()`.
- The service is a plain class with an injected `spawn` (default: `node-pty`'s `spawn`) so it is unit-testable with a fake PTY.

### 3.2 IPC (`src/shared/ipc.ts`, sender-guarded, arguments validated)

| Channel | Direction | Args | Result |
| --- | --- | --- | --- |
| `terminal:open` | invoke | `cols, rows` (ints) | `{ backlog: string }` |
| `terminal:write` | invoke | `data` (string ≤ 64 KB) | `void` |
| `terminal:resize` | invoke | `cols, rows` | `void` |
| `terminal:restart` | invoke | `cols, rows` | `{ backlog: '' }` |
| event `terminal-data` | main → renderer | `{ projectId, data }` | — |
| event `terminal-exit` | main → renderer | `{ projectId, exitCode }` | — |

All calls act on the **currently open project**; the renderer never names a project or a path. No project open → `Error('Open a project first')`.

### 3.3 Renderer

- `components/TerminalPanel.tsx`: xterm.js `Terminal` + `@xterm/addon-fit` + `@xterm/addon-web-links` (links open via the existing safe external-link path, never navigate the window).
  - Theme from `tokens.css` variables (read once via `getComputedStyle`), font `IBM Plex Mono`.
  - On mount: `open(cols, rows)`, write the backlog, subscribe to `terminal-data` for this project.
  - Keystrokes → `write`; fit on panel resize → `resize`.
  - On `terminal-exit`: show "Shell exited (code N) · Restart".
  - Screen-reader mode on (`screenReaderMode: true`).
- Panel: sits below the view in `.main`, height stored per window in `localStorage` (try/catch), default 280 px, min 120, max 70% of the window; a drag handle (`role="separator"`, keyboard-resizable with arrows) on its top edge.
- Header: a **Terminal** toggle button (`aria-pressed`) next to "+ Hire agent"; Ctrl+\` toggles it (Cmd+\` is taken on macOS for window switching). Focus moves into the terminal when it opens and back to the toggle when it closes.
- The panel stays mounted (hidden) when closed, so scrollback and state survive toggling; switching projects re-opens with the other project's backlog.
- CSP is unchanged: xterm.js needs no `eval`; its inline styles are covered by the existing `style-src 'unsafe-inline'`.

## 4. Packaging

- Dependencies: `node-pty` (runtime), `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links`.
- `node-pty` is externalised by electron-vite (main), loaded from `node_modules`; `electron-builder.yml` gains `asarUnpack: ['**/node_modules/node-pty/**']` so the native `.node` and `spawn-helper` are executable outside the asar.
- `electron-builder` rebuilds native modules for Electron's ABI per target arch (default `npmRebuild: true`), including the macOS x64 build on arm64.
- Spike first (plan task 1): `npm run dist` on macOS, plus CI `pack` on all three OSes, and a packaged-app smoke check that the terminal opens. If `node-pty` will not build cleanly, switch to `@lydell/node-pty` (prebuilt binaries for all six OS/arch pairs, same API) and record the decision.
- Electron fuses stay on (`runAsNode: false` etc.); `node-pty` does not need `ELECTRON_RUN_AS_NODE`.

## 5. Security

- A terminal is, by design, full access to the user's machine as the user — the same as their own terminal app. The guarantees are about *who* can drive it:
  - Only the app's own renderer, through the sender guard; the MCP host and agents have no channel to it.
  - The working directory comes from the main process (open project root), never from the renderer.
  - `write` payloads are size-capped; `cols`/`rows` are validated integers.
  - Output is drawn only by xterm.js (no HTML injection path); links open through the existing external-link handler.
- `AO_*` dev hooks are unaffected.

## 6. Error handling

| Case | Behaviour |
| --- | --- |
| No project open | Terminal button hidden; IPC returns `Open a project first`. |
| Shell fails to start (bad `$SHELL`) | Fall back to `/bin/sh` (POSIX) / `cmd.exe` (Windows); if that fails too, the panel shows the error with Restart. |
| Shell exits (`exit`, crash) | Panel shows exit code + Restart; session forgotten. |
| Project closed / app quits | Session killed and awaited; panel cleared. |
| `node-pty` missing (bad install) | Terminal button disabled with tooltip "Terminal unavailable: …"; the rest of the app works. |

## 7. Testing

- `terminalService.test.ts` (fake PTY): one session per project; reopen returns the backlog; output batching; backlog ring cap; resize clamping; exit forgets the session; `killAll` kills every session; shell selection per platform; fallback shell on spawn failure.
- `test/terminal.test.ts` (real `node-pty`, skipped if it fails to load): spawn in a temp repo, run `echo ao-ok`, see it; `pwd`/`cd` shows the project root; kill leaves no process.
- IPC: the five channels validate arguments; calls without an open project fail.
- e2e: open a project, toggle the terminal, type `echo ao-terminal-ok` + Enter, see it in the panel; toggle closed and open again, output still there; Ctrl+\` toggles.
- Packaging: CI `electron-builder --dir` on all three OSes; the spike's packaged-app check on macOS.
- Gates: `npm run typecheck && npm test && npm run test:e2e`, CI green on ubuntu, macOS and Windows.
