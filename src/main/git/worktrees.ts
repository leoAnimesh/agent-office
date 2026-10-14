import { execFile } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { DiffStat } from '../../shared/types';

const pexec = promisify(execFile);

export async function git(cwd: string, args: string[]): Promise<string> {
  const pre = process.platform === 'win32' ? ['-c', 'core.longpaths=true'] : [];
  try {
    const { stdout } = await pexec('git', [...pre, ...args], { cwd, maxBuffer: 20 * 1024 * 1024, windowsHide: true });
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
