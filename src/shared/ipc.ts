import type { Agent, AppStatus, Project, Role, WorkspaceEvent, WorkspaceSnapshot } from './types';

export const IPC = {
  appStatus: 'app:status',
  pickFolder: 'project:pick-folder',
  listProjects: 'project:list',
  openProject: 'project:open',
  snapshot: 'project:snapshot',
  sendToBoss: 'boss:send',
  listRoles: 'team:roles',
  hire: 'team:hire',
  pauseTask: 'task:pause',
  resumeTask: 'task:resume',
  cancelTask: 'task:cancel',
  answerMerge: 'merge:answer',
  event: 'workspace:event',
} as const;

export interface AgentOfficeApi {
  getStatus(): Promise<AppStatus>;
  pickFolder(): Promise<string | null>;
  listProjects(): Promise<Project[]>;
  openProject(repoPath: string): Promise<WorkspaceSnapshot>;
  snapshot(): Promise<WorkspaceSnapshot | null>;
  sendToBoss(text: string): Promise<void>;
  listRoles(): Promise<Role[]>;
  hire(roleId: string, name?: string): Promise<Agent>;
  pauseTask(id: string): Promise<void>;
  resumeTask(id: string): Promise<void>;
  cancelTask(id: string): Promise<void>;
  answerMerge(requestId: string, ok: boolean): Promise<void>;
  onEvent(cb: (e: WorkspaceEvent) => void): () => void;
}
