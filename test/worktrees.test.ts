import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, promises as fs, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorktreeManager, git, inspectRepo } from '../src/main/git/worktrees';
import { makeRepo } from './helpers/repo';

let repo: string;
beforeEach(async () => { repo = await makeRepo(); });
afterEach(async () => { await fs.rm(repo, { recursive: true, force: true }); });

describe('inspectRepo', () => {
  it('returns the root and current branch, even from a subfolder', async () => {
    await fs.mkdir(path.join(repo, 'sub'));
    const info = await inspectRepo(path.join(repo, 'sub'));
    expect(realpathSync.native(info.root)).toBe(repo);
    expect(info.branch).toBe('main');
  });

  it('rejects a folder that is not a git repo', async () => {
    const plain = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-plain-'));
    await expect(inspectRepo(plain)).rejects.toThrow(/is not a git repository/);
    await fs.rm(plain, { recursive: true, force: true });
  });

  it('rejects a repo with no commits', async () => {
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-empty-'));
    await git(empty, ['init', '-q']);
    await expect(inspectRepo(empty)).rejects.toThrow(/no commits yet/);
    await fs.rm(empty, { recursive: true, force: true });
  });
});

describe('WorktreeManager', () => {
  it('creates a worktree on a new branch and hides .agentoffice from git status', async () => {
    const wm = new WorktreeManager(repo);
    const wt = await wm.prepare('Pixel', 'ao/pixel/t-101', 'main');
    expect(wt).toBe(path.join(repo, '.agentoffice', 'wt', 'pixel'));
    expect(await git(wt, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('ao/pixel/t-101');
    expect(await git(repo, ['status', '--porcelain'])).toBe('');
  });

  it('reuses the worktree for the next task and switches branch', async () => {
    const wm = new WorktreeManager(repo);
    await wm.prepare('Pixel', 'ao/pixel/one', 'main');
    const wt = await wm.prepare('Pixel', 'ao/pixel/two', 'main');
    expect(await git(wt, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('ao/pixel/two');
  });

  it('commits leftovers (including new files) and reports the diff against base', async () => {
    const wm = new WorktreeManager(repo);
    const wt = await wm.prepare('Byte', 'ao/byte/x', 'main');
    await fs.writeFile(path.join(wt, 'new.txt'), 'a\nb\n');
    await fs.appendFile(path.join(wt, 'README.md'), 'more\n');
    expect(await wm.commitAll(wt, 'T-101: work')).toBe(true);
    expect(await wm.commitAll(wt, 'nothing')).toBe(false);
    const stat = await wm.diffStat('main', 'ao/byte/x');
    expect(stat).toEqual(expect.arrayContaining([
      { path: 'new.txt', add: 2, del: 0 },
      { path: 'README.md', add: 1, del: 0 },
    ]));
    expect(await git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('main');
  });

  it('saves unfinished work on its own branch before switching to the next task', async () => {
    const wm = new WorktreeManager(repo);
    const wt = await wm.prepare('Pixel', 'ao/pixel/one', 'main');
    await fs.writeFile(path.join(wt, 'half-done.txt'), 'wip\n');
    await wm.prepare('Pixel', 'ao/pixel/two', 'main');
    expect(existsSync(path.join(wt, 'half-done.txt'))).toBe(false);
    expect(await wm.diffStat('main', 'ao/pixel/two')).toEqual([]);
    expect(await wm.diffStat('main', 'ao/pixel/one')).toEqual([{ path: 'half-done.txt', add: 1, del: 0 }]);
  });

  it('recreates a worktree whose folder was deleted by hand', async () => {
    const wm = new WorktreeManager(repo);
    const wt = await wm.prepare('Quinn', 'ao/quinn/a', 'main');
    await fs.rm(wt, { recursive: true, force: true });
    const again = await wm.prepare('Quinn', 'ao/quinn/a', 'main');
    expect(existsSync(path.join(again, 'README.md'))).toBe(true);
  });

  it('keeps worktrees inside .agentoffice/wt for hostile names', () => {
    const wm = new WorktreeManager(repo);
    const p = wm.worktreePath('../../../etc/passwd');
    expect(p.startsWith(path.join(repo, '.agentoffice', 'wt') + path.sep)).toBe(true);
  });
});
