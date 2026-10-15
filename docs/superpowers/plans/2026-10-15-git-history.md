# Git History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A read-only History tab: the project's commits (base branch or any teammate branch, optionally team merges only), a commit's details and changed files, and a coloured diff per file; done tasks link to their merge.

**Design (approved in chat, 2026-10-15):** History tab in the project header; list of 100 commits with Load more (short hash, subject, author, time ago, files +/−); branch picker (base + `ao/*`); "Team merges only" toggle; detail pane with message, author, date, files; click a file for its diff; "View in history" from a done task. Never checks out, reverts or writes. All git runs in main; the renderer's refs, hashes and paths are validated.

## Tasks

- [ ] **1. `src/main/git/history.ts`** (tested against real temp repos): `listBranches`, `listCommits(ref, { skip, limit, mergesOnly })` (first-parent diffs so merges show what they brought in; `T-\d+` parsed from "Merge T-101: …"), `commitDetail(sha)`, `fileDiff(sha, path)` (size-capped). Refs must come from `listBranches`, hashes match `^[0-9a-f]{7,40}$` and resolve to a commit, paths must be in that commit's file list.
- [ ] **2. Merge commit on tasks**: `Task.mergeCommit` set by `AgentManager.merge`.
- [ ] **3. IPC** `history:branches|list|commit|diff` through the sender guard; `ProjectService` uses the open project's repo only.
- [ ] **4. Renderer**: `HistoryView` (list + detail + diff, pure helpers for time-ago and diff line classes, tested), Header tab, view state `{ name: 'history'; sha?: string }`, "View in history" in the task drawer.
- [ ] **5. e2e + screenshots; docs; full gates.**
