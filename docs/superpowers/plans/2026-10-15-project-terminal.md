# Project Terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A full terminal per open project, in a resizable bottom panel, backed by a PTY in the main process.

**Spec:** `docs/superpowers/specs/2026-10-15-project-terminal-design.md`

## Rulings from the spike (task 0)

- `node-pty@1.1.0` installs with macOS/Windows prebuilds whose `spawn-helper` lacks the execute bit (`posix_spawnp failed`) and has no Linux prebuild. `@lydell/node-pty@1.2.0-beta.15` (same API, N-API prebuilds for all six OS/arch pairs, correct permissions) loads in both Node 22 and Electron 44 with no rebuild. **Use `@lydell/node-pty`, pinned exactly** (it is a beta). Cost if wrong: swap the import back to `node-pty` and add a postinstall `chmod` + Linux toolchain in CI.
- xterm.js `@xterm/xterm@6.0.0` + `@xterm/addon-fit@0.11.0` + `@xterm/addon-web-links`, pinned.

## Tasks

- [ ] **1. `TerminalService`** (`src/main/terminal/terminalService.ts`) with an injected `spawn`. Tests with a fake PTY: one session per project, reopen returns the backlog, ~16 ms output batching, 256 KB backlog cap, resize clamping, exit forgets the session and emits, `killAll`, shell per platform, fallback shell when spawn throws.
- [ ] **2. Real PTY test** (`test/terminal.test.ts`): spawn in a temp folder, `echo`, `pwd` = cwd, kill leaves nothing running.
- [ ] **3. Wiring**: `ProjectService` owns the service; cwd = open project root; `killAll` on project close and app quit; IPC `terminal:open|write|resize|restart` + `terminal-data`/`terminal-exit` events through the sender guard; preload + `AgentOfficeApi`.
- [ ] **4. Renderer**: `TerminalPanel` (xterm + fit + web-links, theme from tokens, screen-reader mode), Header **Terminal** toggle (`aria-pressed`) + Ctrl+\`, resizable panel with a keyboard-operable separator, height remembered in `localStorage`.
- [ ] **5. Packaging**: `asarUnpack` for the pty packages; `npm run pack` and launch the packaged app on macOS; CI `electron-builder --dir` on all three OSes.
- [ ] **6. e2e**: toggle the terminal, run `echo ao-terminal-ok`, see it; toggle off/on keeps output.
- [ ] **7. Docs** (AGENTS.md architecture + security notes), full gates, fresh review.
