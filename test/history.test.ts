import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { git } from '../src/main/git/worktrees';
import { commitDetail, fileDiff, listBranches, listCommits } from '../src/main/git/history';
import { makeRepo } from './helpers/repo';

let repo: string;

/** main: init, "docs", and a no-ff merge of a teammate branch that adds src/app.ts and edits README. */
beforeEach(async () => {
  repo = await makeRepo();
  await fs.writeFile(path.join(repo, 'docs.md'), 'docs\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-q', '-m', 'docs']);
  await git(repo, ['checkout', '-q', '-b', 'ao/pixel/app-t-101']);
  await fs.mkdir(path.join(repo, 'src'));
  await fs.writeFile(path.join(repo, 'src', 'app.ts'), 'export const a = 1;\nexport const b = 2;\n');
  await fs.appendFile(path.join(repo, 'README.md'), 'more\n');
  await git(repo, ['add', '.']);
  await git(repo, ['-c', 'user.name=Pixel', 'commit', '-q', '-m', 'Add the app']);
  await git(repo, ['checkout', '-q', 'main']);
  await git(repo, ['merge', '--no-ff', '-q', '-m', 'Merge T-101: Add the app', 'ao/pixel/app-t-101']);
});
afterEach(async () => { await fs.rm(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); });

describe('listBranches', () => {
  it('lists the local branches with the current one first', async () => {
    expect(await listBranches(repo)).toEqual(['main', 'ao/pixel/app-t-101']);
  });
});

describe('listCommits', () => {
  it('lists the branch newest first, with what each merge brought in', async () => {
    const commits = await listCommits(repo, 'main', {});
    expect(commits.map((c) => c.subject)).toEqual(['Merge T-101: Add the app', 'docs', 'init']);
    expect(commits[0]).toMatchObject({ isMerge: true, taskId: 'T-101', author: 'Test User', files: 2, add: 3, del: 0 });
    expect(commits[0].sha).toMatch(/^[0-9a-f]{40}$/);
    expect(commits[0].short).toBe(commits[0].sha.slice(0, commits[0].short.length));
    expect(commits[1]).toMatchObject({ isMerge: false, taskId: null, files: 1, add: 1, del: 0 });
    expect(Date.parse(commits[0].date)).not.toBeNaN();
  });

  it('pages and filters to team merges', async () => {
    expect((await listCommits(repo, 'main', { skip: 1, limit: 1 })).map((c) => c.subject)).toEqual(['docs']);
    expect((await listCommits(repo, 'main', { mergesOnly: true })).map((c) => c.subject)).toEqual(['Merge T-101: Add the app']);
    expect((await listCommits(repo, 'ao/pixel/app-t-101', {}))[0]).toMatchObject({ subject: 'Add the app', author: 'Pixel' });
  });

  it('refuses refs that are not local branches', async () => {
    await expect(listCommits(repo, '--all', {})).rejects.toThrow(/Unknown branch/);
    await expect(listCommits(repo, 'HEAD~1', {})).rejects.toThrow(/Unknown branch/);
  });
});

describe('commitDetail and fileDiff', () => {
  it('describes a merge by what it brought in, and diffs one of its files', async () => {
    const [merge] = await listCommits(repo, 'main', {});
    const d = await commitDetail(repo, merge.sha);
    expect(d).toMatchObject({ sha: merge.sha, subject: 'Merge T-101: Add the app', parents: 2, taskId: 'T-101' });
    expect(d.files).toEqual([{ path: 'README.md', add: 1, del: 0 }, { path: 'src/app.ts', add: 2, del: 0 }]);
    const diff = await fileDiff(repo, merge.sha, 'src/app.ts');
    expect(diff).toContain('+export const a = 1;');
    expect(diff).toContain('src/app.ts');
  });

  it('refuses bad hashes, unknown commits and paths outside the commit', async () => {
    const [merge] = await listCommits(repo, 'main', {});
    await expect(commitDetail(repo, 'not-a-sha')).rejects.toThrow(/commit/);
    await expect(commitDetail(repo, 'abcdef1234567')).rejects.toThrow(/commit/);
    await expect(fileDiff(repo, merge.sha, '../etc/passwd')).rejects.toThrow(/not changed/);
    await expect(fileDiff(repo, merge.sha, 'docs.md')).rejects.toThrow(/not changed/);
  });
});
