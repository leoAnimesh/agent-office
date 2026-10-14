import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentManager, type ManagerEvent } from '../../src/main/agents/agentManager';
import { ClaudeRunner } from '../../src/main/claude/runner';
import { WorktreeManager } from '../../src/main/git/worktrees';
import { dataPaths, type DataPaths } from '../../src/main/store/paths';
import { ProjectStore } from '../../src/main/store/projectStore';
import { RoleStore } from '../../src/main/store/roleStore';
import { SkillStore } from '../../src/main/store/skillStore';
import type { ModelPick, Project } from '../../src/shared/types';
import type { TaskClassifier } from '../../src/main/agents/classifier';
import { makeRepo } from './repo';
import { FAKE_CLAUDE } from './runner';

export const STUB_PICK: ModelPick = { model: 'sonnet', size: 'medium', reason: 'stub', source: 'classifier' };

export interface Harness {
  repo: string;
  data: string;
  argvOut: string;
  fakeEnv: Record<string, string>;
  paths: DataPaths;
  make(opts?: { maxConcurrent?: number; autoMerge?: boolean; classify?: TaskClassifier }): Promise<{ manager: AgentManager; project: Project; roles: RoleStore; skills: SkillStore; store: ProjectStore }>;
  launches(): Promise<{ argv: string[]; cwd: string }[]>;
  cleanup(): Promise<void>;
}

export async function harness(): Promise<Harness> {
  const repo = await makeRepo();
  const data = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-h-'));
  const argvOut = path.join(data, 'argv.jsonl');
  const fakeEnv: Record<string, string> = { FAKE_CLAUDE_ARGV_OUT: argvOut, FAKE_CLAUDE_FILE: 'notes.txt' };
  const paths = dataPaths(data);
  const managers: AgentManager[] = [];
  return {
    repo, data, argvOut, fakeEnv, paths,
    async make(opts = {}) {
      const roles = new RoleStore(paths.rolesDir);
      const skills = new SkillStore(paths.skillsDir);
      const store = new ProjectStore(paths);
      await roles.seed(path.resolve('resources/roles'));
      await skills.seed(path.resolve('resources/skills'));
      const project: Project = { id: 'p1', name: 'demo', repoPath: repo, baseBranch: 'main', maxConcurrent: opts.maxConcurrent ?? 4, bossCanHire: true, autoMerge: opts.autoMerge ?? false };
      const manager = new AgentManager({
        project, store, roles, skills, worktrees: new WorktreeManager(repo),
        createRunner: (o) => new ClaudeRunner({ ...o, bin: process.execPath, binArgs: [FAKE_CLAUDE], env: { ...process.env, ...fakeEnv } }),
        claudeBin: 'claude', promptDir: paths.promptDir, isolateUserSettings: true,
        classify: opts.classify ?? (async () => STUB_PICK),
      });
      await manager.load();
      managers.push(manager);
      return { manager, project, roles, skills, store };
    },
    async launches() {
      const raw = await fs.readFile(argvOut, 'utf8').catch(() => '');
      return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l) as { argv: string[]; cwd: string });
    },
    async cleanup() {
      for (const m of managers) await m.shutdown();
      await fs.rm(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      await fs.rm(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}

type Emitter = { on(e: 'event', l: (e: ManagerEvent) => void): unknown; off(e: 'event', l: (e: ManagerEvent) => void): unknown };

export function waitFor(m: Emitter, pred: (e: ManagerEvent) => boolean, ms = 20000): Promise<ManagerEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { m.off('event', l); reject(new Error('timed out waiting for manager event')); }, ms);
    const l = (e: ManagerEvent) => { if (pred(e)) { clearTimeout(timer); m.off('event', l); resolve(e); } };
    m.on('event', l);
  });
}

export const finished = (m: AgentManager, id: string) => waitFor(m, (e) => e.type === 'task-finished' && e.task.id === id);
