import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorktreeManager, git } from '../src/main/git/worktrees';
import { makeRepo } from './helpers/repo';

let repo: string;
let remote: string;
let other: string;
const id = ['-c', 'user.email=t@t', '-c', 'user.name=t'];

beforeEach(async () => {
  repo = await makeRepo();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-sync-'));
  remote = path.join(tmp, 'remote.git');
  other = path.join(tmp, 'other');
  await git(tmp, ['clone', '--bare', repo, remote]);
  await git(repo, ['remote', 'add', 'origin', remote]);
  await git(repo, ['fetch', 'origin']);
  await git(repo, ['branch', '--set-upstream-to=origin/main', 'main']);
  await git(tmp, ['clone', remote, other]);
});
afterEach(async () => {
  await fs.rm(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  await fs.rm(path.dirname(remote), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

/** A teammate pushes a commit to the remote branch. */
async function pushFromOther(branch: string, file: string) {
  await git(other, ['checkout', '-B', branch, `origin/${branch === 'main' ? 'main' : 'main'}`]);
  await fs.writeFile(path.join(other, file), 'x\n');
  await git(other, ['add', file]);
  await git(other, [...id, 'commit', '-m', `add ${file}`]);
  await git(other, ['push', 'origin', branch]);
}

describe('syncBranch', () => {
  it('switches to the branch and pulls new commits fast-forward', async () => {
    await git(repo, ['checkout', '-b', 'feature']);
    await pushFromOther('main', 'remote.txt');
    const r = await new WorktreeManager(repo).syncBranch('main');
    expect(r).toMatchObject({ status: 'synced', branch: 'main', from: 'feature', pulled: 1 });
    expect(await git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('main');
    await expect(fs.readFile(path.join(repo, 'remote.txt'), 'utf8')).resolves.toBe('x\n');
  });

  it('checks out a branch that only exists on the remote', async () => {
    await pushFromOther('release', 'rel.txt');
    const r = await new WorktreeManager(repo).syncBranch('release');
    expect(r).toMatchObject({ status: 'synced', branch: 'release' });
    expect(await git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('release');
  });

  it('refuses when tracked files have uncommitted changes', async () => {
    await fs.appendFile(path.join(repo, 'README.md'), 'local\n');
    expect(await new WorktreeManager(repo).syncBranch('main')).toMatchObject({ status: 'blocked', reason: expect.stringMatching(/uncommitted/) });
  });

  it('refuses to pull when local main has commits the remote does not (no merge commits)', async () => {
    await fs.writeFile(path.join(repo, 'local.txt'), 'l\n');
    await git(repo, ['add', 'local.txt']);
    await git(repo, [...id, 'commit', '-m', 'local']);
    await pushFromOther('main', 'remote.txt');
    expect(await new WorktreeManager(repo).syncBranch('main')).toMatchObject({ status: 'blocked', reason: expect.stringMatching(/fast-forward/) });
  });

  it('refuses unknown and invalid branch names', async () => {
    const wt = new WorktreeManager(repo);
    expect(await wt.syncBranch('nope')).toMatchObject({ status: 'blocked', reason: expect.stringMatching(/No branch named nope/) });
    expect(await wt.syncBranch('--upload-pack=evil')).toMatchObject({ status: 'blocked', reason: expect.stringMatching(/not a valid branch name/) });
    expect(await wt.syncBranch('a..b')).toMatchObject({ status: 'blocked', reason: expect.stringMatching(/not a valid branch name/) });
  });

  it('just switches when the repo has no remote', async () => {
    await git(repo, ['remote', 'remove', 'origin']);
    await git(repo, ['checkout', '-b', 'feature']);
    expect(await new WorktreeManager(repo).syncBranch('main')).toMatchObject({ status: 'synced', branch: 'main', pulled: 0, remote: false });
  });
});
