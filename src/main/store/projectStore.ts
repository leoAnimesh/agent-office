import { promises as fs } from 'node:fs';
import type { Agent, Project, Task } from '../../shared/types';
import { appendJsonl, readJson, readJsonl, writeJsonAtomic } from './jsonStore';
import type { DataPaths } from './paths';

export class ProjectStore {
  constructor(private readonly paths: DataPaths) {}

  async listProjects(): Promise<Project[]> {
    let ids: string[];
    try {
      ids = await fs.readdir(this.paths.projectsDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const projects = await Promise.all(ids.map((id) => this.getProject(id)));
    return projects.filter((p): p is Project => p !== null);
  }

  getProject(id: string): Promise<Project | null> {
    return readJson<Project | null>(this.paths.projectFile(id), null);
  }

  saveProject(project: Project): Promise<void> {
    return writeJsonAtomic(this.paths.projectFile(project.id), project);
  }

  getAgents(projectId: string): Promise<Agent[]> {
    return readJson<Agent[]>(this.paths.agentsFile(projectId), []);
  }

  saveAgents(projectId: string, agents: Agent[]): Promise<void> {
    return writeJsonAtomic(this.paths.agentsFile(projectId), agents);
  }

  getTasks(projectId: string): Promise<Task[]> {
    return readJson<Task[]>(this.paths.tasksFile(projectId), []);
  }

  saveTasks(projectId: string, tasks: Task[]): Promise<void> {
    return writeJsonAtomic(this.paths.tasksFile(projectId), tasks);
  }

  appendLog(projectId: string, agentId: string, entry: unknown): Promise<void> {
    return appendJsonl(this.paths.logFile(projectId, agentId), entry);
  }

  readLog(projectId: string, agentId: string, limit = 500): Promise<unknown[]> {
    return readJsonl(this.paths.logFile(projectId, agentId), limit);
  }
}

export function nextTaskId(tasks: Pick<Task, 'id'>[]): string {
  const max = tasks.reduce((m, t) => Math.max(m, Number(t.id.replace(/^T-/, '')) || 0), 100);
  return `T-${max + 1}`;
}
