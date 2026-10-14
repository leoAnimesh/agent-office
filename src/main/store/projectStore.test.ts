import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dataPaths } from './paths';
import { ProjectStore, nextTaskId } from './projectStore';
import type { Project, Task } from '../../shared/types';

let root: string;
let store: ProjectStore;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-data-'));
  store = new ProjectStore(dataPaths(root));
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

const project: Project = { id: 'p1', name: 'demo', repoPath: '/tmp/demo', baseBranch: 'main', maxConcurrent: 4, bossCanHire: true, autoMerge: false };

describe('ProjectStore', () => {
  it('lists nothing before any project exists', async () => {
    expect(await store.listProjects()).toEqual([]);
  });

  it('saves and lists projects, agents and tasks', async () => {
    await store.saveProject(project);
    expect(await store.listProjects()).toEqual([project]);
    expect(await store.getAgents('p1')).toEqual([]);
    await store.saveTasks('p1', [{ id: 'T-101' } as Task]);
    expect((await store.getTasks('p1'))[0].id).toBe('T-101');
  });

  it('appends and reads agent logs', async () => {
    await store.appendLog('p1', 'a1', { n: 1 });
    await store.appendLog('p1', 'a1', { n: 2 });
    expect(await store.readLog('p1', 'a1')).toEqual([{ n: 1 }, { n: 2 }]);
  });
});

describe('nextTaskId', () => {
  it('starts at T-101 and increments past the highest id', () => {
    expect(nextTaskId([])).toBe('T-101');
    expect(nextTaskId([{ id: 'T-101' }, { id: 'T-107' }, { id: 'T-103' }] as Task[])).toBe('T-108');
  });
});
