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
      await git(wt, exists ? ['checkout', branch] : ['checkout', '-b', branch, fromRef]);
    }
    return wt;
  }

  async commitAll(worktree: string, message: string): Promise<boolean> {
    if (!(await git(worktree, ['status', '--porcelain']))) return false;
    await git(worktree, ['add', '-A']);
    const hasIdentity = await git(worktree, ['config', 'user.email']).then(Boolean, () => false);
    const identity = hasIdentity ? [] : ['-c', 'user.name=AgentOffice', '-c', 'user.email=agentoffice@localhost'];
    await git(worktree, [...identity, 'commit', '-q', '-m', message]);
    return true;
  }

  async diffStat(base: string, branch: string): Promise<DiffStat[]> {
    return parseNumstat(await git(this.repoRoot, ['diff', '--numstat', `${base}...${branch}`]));
  }

  async remove(agentName: string): Promise<void> {
    await git(this.repoRoot, ['worktree', 'remove', '--force', this.worktreePath(agentName)]).catch(() => undefined);
  }
}
