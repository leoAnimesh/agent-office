import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { WorktreeManager, git } from '../src/main/git/worktrees';
import { makeRepo } from './helpers/repo';

let repo: string;
let wm: WorktreeManager;
beforeEach(async () => { repo = await makeRepo(); wm = new WorktreeManager(repo); });
afterEach(async () => { await fs.rm(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); });

async function workOn(branch: string, file: string, content: string): Promise<void> {
  const wt = await wm.prepare('Pixel', branch, 'main');
  await fs.writeFile(path.join(wt, file), content);
  await wm.commitAll(wt, `work on ${file}`);
}

describe('WorktreeManager.merge', () => {
  it('merges a task branch into the base branch with a merge commit', async () => {
    await workOn('ao/pixel/a', 'hello.txt', 'hi\n');
    const r = await wm.merge('main', 'ao/pixel/a', 'Merge T-101: hello');
    expect(r.status).toBe('merged');
    expect(await fs.readFile(path.join(repo, 'hello.txt'), 'utf8')).toBe('hi\n');
    expect(await git(repo, ['log', '-1', '--format=%s'])).toBe('Merge T-101: hello');
  });

  it('reports conflicts, aborts, and leaves the checkout clean', async () => {
    await workOn('ao/pixel/a', 'README.md', 'from pixel\n');
    await fs.writeFile(path.join(repo, 'README.md'), 'from main\n');
    await git(repo, ['commit', '-qam', 'main edit']);
    const r = await wm.merge('main', 'ao/pixel/a', 'Merge');
    expect(r).toEqual({ status: 'conflict', files: ['README.md'] });
    expect(await git(repo, ['status', '--porcelain'])).toBe('');
    expect(await fs.readFile(path.join(repo, 'README.md'), 'utf8')).toBe('from main\n');
  });

  it('refuses when the checkout has uncommitted changes', async () => {
    await workOn('ao/pixel/a', 'hello.txt', 'hi\n');
    await fs.writeFile(path.join(repo, 'README.md'), 'local edit\n');
    const r = await wm.merge('main', 'ao/pixel/a', 'Merge');
    expect(r).toMatchObject({ status: 'blocked', reason: expect.stringMatching(/uncommitted changes/) });
    expect(existsSync(path.join(repo, 'hello.txt'))).toBe(false);
  });

  it('ignores untracked files the merge does not touch', async () => {
    await workOn('ao/pixel/a', 'hello.txt', 'hi\n');
    await fs.writeFile(path.join(repo, 'scratch.txt'), 'mine');
    expect((await wm.merge('main', 'ao/pixel/a', 'Merge')).status).toBe('merged');
    expect(await fs.readFile(path.join(repo, 'scratch.txt'), 'utf8')).toBe('mine');
  });

  it('refuses when the checkout is on another branch', async () => {
    await workOn('ao/pixel/a', 'hello.txt', 'hi\n');
    await git(repo, ['checkout', '-qb', 'feature']);
    const r = await wm.merge('main', 'ao/pixel/a', 'Merge');
    expect(r).toMatchObject({ status: 'blocked', reason: expect.stringMatching(/on branch feature/) });
  });
});
