# AgentOffice

A desktop app where a **boss** Claude Code agent hires a team of specialist agents (frontend, backend, QA, …), hands out tasks, and reviews their work, all shown as a pixel-art office.

> Status: early development. Runs on macOS, Windows and Linux.

## Requirements
- [Claude Code](https://docs.claude.com/en/docs/claude-code) installed and signed in (`claude --version` works)
- git ≥ 2.28, Node.js 22 (for development)

## Develop

```bash
npm install
npm run dev       # launch the app
npm test          # unit + integration tests (uses a fake claude CLI)
```

## Safety
Each agent works in its own git worktree, but agents run with your user's permissions. Staying inside the worktree is an instruction to the agent, not a sandbox.

## License
MIT
