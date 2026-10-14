# AgentOffice

A desktop app where a **boss** Claude Code agent hires a team of specialist agents (frontend, backend, QA, …), hands out tasks, and reviews their work, all shown as a pixel-art office.

> Status: early development (v0.1). Runs on macOS, Windows and Linux. Open a repo, chat with the boss, and watch your pixel team hire, delegate, build and ask you to merge.

## Install
Download the latest build for your OS from [Releases](https://github.com/leoAnimesh/agent-office/releases):
- **macOS:** `AgentOffice-x.y.z.dmg`. The app is not notarized yet. After dragging it to Applications, right-click it and choose **Open** the first time.
- **Windows:** `AgentOffice Setup x.y.z.exe`. If SmartScreen warns, choose **More info → Run anyway**.
- **Linux:** `AgentOffice-x.y.z.AppImage` (`chmod +x` it, then run it) or the `.deb` package.

You also need [Claude Code](https://docs.claude.com/en/docs/claude-code) installed and signed in. AgentOffice uses your own Claude account.

## Requirements
- [Claude Code](https://docs.claude.com/en/docs/claude-code) installed and signed in (`claude --version` works)
- git ≥ 2.28, Node.js 22 (for development)

## Develop

```bash
npm install
npm run dev       # launch the app
npm test          # unit + integration tests (uses a fake claude CLI)
```

## How it works
- **Boss:** a long-running `claude` session in your repo with read-only tools plus AgentOffice's MCP tools (`list_team`, `hire`, `assign_task`, `get_task`, `message_agent`, `request_merge`, …). It plans and reviews; it never edits files.
- **Employees:** each task runs as `claude -p` in the employee's own git worktree (`.agentoffice/wt/<name>`) on branch `ao/<name>/<task>`.
- **Merging:** the boss asks; you approve in the chat (unless auto-merge is on). Merges never run while your checkout has uncommitted changes to tracked files or is on another branch.
- Real end-to-end test (spends Claude usage): `AO_REAL_CLAUDE=1 npx vitest run test/real`

Test-only environment variables: `AO_USER_DATA` (app data folder), `AO_CLAUDE_BIN` + `AO_CLAUDE_ARGS` (use a stand-in CLI such as `node test/fake-claude/fake-claude.mjs`), `AO_CLAUDE_MISSING=1` (pretend Claude Code is not installed), `AO_E2E_PICK_FOLDER` (folder the picker returns).

Build installers: `npm run dist` (output in `release/`).

## Safety
Each agent works in its own git worktree, but agents run with your user's permissions. Staying inside the worktree is an instruction to the agent, not a sandbox.

## License
MIT
