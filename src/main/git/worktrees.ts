import { execFile } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { DiffStat } from '../../shared/types';

const pexec = promisify(execFile);

export async function git(cwd: string, args: string[], opts: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}): Promise<string> {
  const pre = process.platform === 'win32' ? ['-c', 'core.longpaths=true'] : [];
  try {
    const { stdout } = await pexec('git', [...pre, ...args], { cwd, maxBuffer: 20 * 1024 * 1024, windowsHide: true, timeout: opts.timeoutMs, env: opts.env ? { ...process.env, ...opts.env } : undefined });
    return stdout.trim();
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    throw new Error(`git ${args.join(' ')} failed: ${(err.stderr || err.message).trim()}`);
  }
}

export function slugify(s: string, fallback = 'agent'): string {
  const out = s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return out || fallback;
}

export interface RepoInfo { root: string; branch: string }

export async function inspectRepo(dir: string): Promise<RepoInfo> {
  let root: string;
  try {
    root = await git(dir, ['rev-parse', '--show-toplevel']);
  } catch {
    throw new Error(`${dir} is not a git repository`);
  }
  try {
    await git(root, ['rev-parse', '--verify', 'HEAD']);
  } catch {
    throw new Error('This repository has no commits yet. Make a first commit, then open it in AgentOffice.');
  }
  const branch = await git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return { root: path.resolve(root), branch };
}

export function parseNumstat(out: string): DiffStat[] {
  return out
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [a, d, ...rest] = line.split('\t');
      return { path: rest.join('\t'), add: Number(a) || 0, del: Number(d) || 0 };
    });
}

export type SyncResult =
  | { status: 'synced'; branch: string; from: string; head: string; pulled: number; remote: boolean }
  | { status: 'blocked'; reason: string };

export type MergeResult =
  | { status: 'merged'; commit: string }
  | { status: 'conflict'; files: string[] }
  | { status: 'blocked'; reason: string };

/** Use the user's git identity; fall back to an AgentOffice one so commits never fail. */
export async function identityArgs(cwd: string): Promise<string[]> {
  const has = await git(cwd, ['config', 'user.email']).then(Boolean, () => false);
  return has ? [] : ['-c', 'user.name=AgentOffice', '-c', 'user.email=agentoffice@localhost'];
}

export class WorktreeManager {
  constructor(readonly repoRoot: string) {}

  worktreePath(agentName: string): string {
    return path.join(this.repoRoot, '.agentoffice', 'wt', slugify(agentName));
  }

  async ensureExcluded(): Promise<void> {
    const rel = await git(this.repoRoot, ['rev-parse', '--git-path', 'info/exclude']);
    const file = path.resolve(this.repoRoot, rel);
    let cur = '';
    try { cur = await fs.readFile(file, 'utf8'); } catch { /* no exclude file yet */ }
    if (cur.split(/\r?\n/).includes('.agentoffice/')) return;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, (cur && !cur.endsWith('\n') ? '\n' : '') + '.agentoffice/\n');
  }

  private async branchExists(branch: string): Promise<boolean> {
    try {
      await git(this.repoRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
      return true;
    } catch {
      return false;
    }
  }

  async prepare(agentName: string, branch: string, fromRef: string): Promise<string> {
    await this.ensureExcluded();
    const wt = this.worktreePath(agentName);
    const exists = await this.branchExists(branch);
    if (!existsSync(path.join(wt, '.git'))) {
      await git(this.repoRoot, ['worktree', 'prune']);
      await fs.rm(wt, { recursive: true, force: true });
      await fs.mkdir(path.dirname(wt), { recursive: true });
      await git(this.repoRoot, exists ? ['worktree', 'add', wt, branch] : ['worktree', 'add', '-b', branch, wt, fromRef]);
    } else {
      // A paused or cancelled task may have left edits behind: keep them on their own branch.
      await this.commitAll(wt, 'WIP: unfinished work saved by AgentOffice before switching tasks');
      await git(wt, exists ? ['checkout', branch] : ['checkout', '-b', branch, fromRef]);
    }
    return wt;
  }

  async commitAll(worktree: string, message: string): Promise<boolean> {
    if (!(await git(worktree, ['status', '--porcelain']))) return false;
    await git(worktree, ['add', '-A']);
    await git(worktree, [...(await identityArgs(worktree)), 'commit', '-q', '-m', message]);
    return true;
  }

  async diffStat(base: string, branch: string): Promise<DiffStat[]> {
    return parseNumstat(await git(this.repoRoot, ['diff', '--numstat', `${base}...${branch}`]));
  }

  /**
   * Switch the project folder to `branch` and pull it fast-forward only. Refuses on uncommitted changes to tracked
   * files, unknown or malformed names, and a pull that would need a merge. Never prompts for credentials.
   */
  async syncBranch(branch: string): Promise<SyncResult> {
    const bad = branch.startsWith('-') || (await git(this.repoRoot, ['check-ref-format', '--branch', branch]).then(() => false, () => true));
    if (bad) return { status: 'blocked', reason: `"${branch}" is not a valid branch name.` };
    if (await git(this.repoRoot, ['status', '--porcelain', '--untracked-files=no'])) {
      return { status: 'blocked', reason: 'The project folder has uncommitted changes. Commit or stash them, then ask again.' };
    }
    const has = (ref: string) => git(this.repoRoot, ['rev-parse', '--verify', '--quiet', ref]).then(() => true, () => false);
    const remote = (await git(this.repoRoot, ['remote'])).split(/\r?\n/).includes('origin');
    if (remote) {
      try {
        await git(this.repoRoot, ['fetch', '--prune', 'origin'], { timeoutMs: 60_000, env: { GIT_TERMINAL_PROMPT: '0' } });
      } catch (e) {
        return { status: 'blocked', reason: `Could not fetch from origin: ${e instanceof Error ? e.message : String(e)}` };
      }
    }
    const upstream = remote && (await has(`refs/remotes/origin/${branch}`));
    const from = await git(this.repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
    try {
      if (await has(`refs/heads/${branch}`)) {
        if (from !== branch) await git(this.repoRoot, ['checkout', branch]);
      } else if (upstream) {
        await git(this.repoRoot, ['checkout', '-b', branch, '--track', `origin/${branch}`]);
      } else {
        return { status: 'blocked', reason: `No branch named ${branch} here or on origin.` };
      }
    } catch (e) {
      return { status: 'blocked', reason: `Could not switch to ${branch}: ${e instanceof Error ? e.message : String(e)}` };
    }
    let pulled = 0;
    if (upstream) {
      pulled = Number(await git(this.repoRoot, ['rev-list', '--count', `HEAD..origin/${branch}`]));
      try {
        if (pulled > 0) await git(this.repoRoot, ['merge', '--ff-only', `origin/${branch}`]);
      } catch {
        return { status: 'blocked', reason: `Switched to ${branch}, but it has local commits that origin/${branch} does not, so it can't fast-forward. Pull or rebase it yourself.` };
      }
    }
    return { status: 'synced', branch, from, head: await git(this.repoRoot, ['rev-parse', '--short', 'HEAD']), pulled, remote };
  }

  async merge(base: string, branch: string, message: string): Promise<MergeResult> {
    await this.ensureExcluded();
    const head = await git(this.repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (head === 'HEAD') return { status: 'blocked', reason: `The project folder is not on a branch (detached HEAD). Check out ${base} to merge.` };
    if (head !== base) {
      return { status: 'blocked', reason: `The project folder is on branch ${head}. Switch it back to ${base} to merge.` };
    }
    if (await git(this.repoRoot, ['status', '--porcelain', '--untracked-files=no'])) {
      return { status: 'blocked', reason: 'The project folder has uncommitted changes. Commit or stash them, then ask again.' };
    }
    try {
      await git(this.repoRoot, [...(await identityArgs(this.repoRoot)), 'merge', '--no-ff', '-m', message, branch]);
      return { status: 'merged', commit: await git(this.repoRoot, ['rev-parse', 'HEAD']) };
    } catch (err) {
      const files = (await git(this.repoRoot, ['diff', '--name-only', '--diff-filter=U']).catch(() => '')).split(/\r?\n/).filter(Boolean);
      await git(this.repoRoot, ['merge', '--abort']).catch(() => undefined);
      if (files.length > 0) return { status: 'conflict', files };
      throw err;
    }
  }

  async remove(agentName: string): Promise<void> {
    await git(this.repoRoot, ['worktree', 'remove', '--force', this.worktreePath(agentName)]).catch(() => undefined);
  }
}
