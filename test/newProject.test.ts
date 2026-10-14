import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git } from '../src/main/git/worktrees';
import { createRepo, projectFolderName } from '../src/main/workspace/newProject';

let parent: string;
beforeEach(async () => { parent = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-new-')); });
afterEach(async () => { await fs.rm(parent, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); });

describe('projectFolderName', () => {
  it('keeps friendly names and trims them', () => {
    expect(projectFolderName('  Recipe App ')).toBe('Recipe App');
    expect(projectFolderName('ünïcode-ok_1')).toBe('ünïcode-ok_1');
  });

  it.each(['', '   ', '..', '.', 'a/b', 'a\\b', 'what?', 'x:y', 'CON', 'nul.txt', 'com1', 'ends.', 'a'.repeat(61), 'tab\there'])('rejects %j', (bad) => {
    expect(() => projectFolderName(bad)).toThrow();
  });
});

describe('createRepo', () => {
  it('creates a git repo on main with a first commit, README and .gitignore', async () => {
    const dir = await createRepo({ parentDir: parent, name: 'Recipe App', brief: 'A small app to keep recipes.' });
    expect(dir).toBe(path.join(parent, 'Recipe App'));
    expect(await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('main');
    expect(await git(dir, ['log', '--format=%s'])).toBe('Initial commit');
    expect(await fs.readFile(path.join(dir, 'README.md'), 'utf8')).toBe('# Recipe App\n\nA small app to keep recipes.\n');
    expect(await fs.readFile(path.join(dir, '.gitignore'), 'utf8')).toContain('node_modules/');
    expect(await git(dir, ['status', '--porcelain'])).toBe('');
  });

  it('reuses an existing empty folder but refuses one with files in it', async () => {
    await fs.mkdir(path.join(parent, 'Empty'));
    await expect(createRepo({ parentDir: parent, name: 'Empty' })).resolves.toBe(path.join(parent, 'Empty'));
    await fs.mkdir(path.join(parent, 'Busy'));
    await fs.writeFile(path.join(parent, 'Busy', 'keep.txt'), 'mine');
    await expect(createRepo({ parentDir: parent, name: 'Busy' })).rejects.toThrow(/already exists .* not empty/);
    expect(await fs.readFile(path.join(parent, 'Busy', 'keep.txt'), 'utf8')).toBe('mine');
  });

  it('refuses a location that is not a folder', async () => {
    await expect(createRepo({ parentDir: path.join(parent, 'missing'), name: 'X' })).rejects.toThrow(/Location .* does not exist/);
  });
});
