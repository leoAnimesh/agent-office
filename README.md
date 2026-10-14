# AgentOffice

A desktop app where a **boss** Claude Code agent hires a team of specialist agents (frontend, backend, QA, …), hands out tasks, and reviews their work, all shown as a pixel-art office.

> Status: early development. Runs on macOS, Windows and Linux. You can open a repo, chat with the boss, and watch it hire and delegate; the pixel-art office arrives next.

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
- **Merging:** the boss asks; you approve in the chat (unless auto-merge is on). Merges never touch a checkout that has uncommitted changes.
- Real end-to-end test (spends Claude usage): `AO_REAL_CLAUDE=1 npx vitest run test/real`

## Safety
Each agent works in its own git worktree, but agents run with your user's permissions. Staying inside the worktree is an instruction to the agent, not a sandbox.

## License
MIT
