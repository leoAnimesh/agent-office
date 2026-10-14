import type { Agent, AppSettings, AppStatus, LogEntry, OpenOptions, Project, ProjectPatch, Role, Skill, WorkspaceEvent, WorkspaceSnapshot } from './types';

export const IPC = {
  appStatus: 'app:status',
  openExternal: 'app:open-external',
  pickFolder: 'project:pick-folder',
  listProjects: 'project:list',
  openProject: 'project:open',
  closeProject: 'project:close',
  updateProject: 'project:update',
  snapshot: 'project:snapshot',
  sendToBoss: 'boss:send',
  listRoles: 'team:roles',
  saveRole: 'team:save-role',
  listSkills: 'team:skills',
  saveSkill: 'team:save-skill',
  hire: 'team:hire',
  fireAgent: 'team:fire',
  agentLog: 'agent:log',
  messageAgent: 'agent:message',
  openWorktree: 'agent:open-worktree',
  pauseTask: 'task:pause',
  resumeTask: 'task:resume',
  cancelTask: 'task:cancel',
  answerMerge: 'merge:answer',
  getSettings: 'settings:get',
  saveSettings: 'settings:save',
  event: 'workspace:event',
} as const;

export interface AgentOfficeApi {
  getStatus(): Promise<AppStatus>;
  openExternal(url: string): Promise<void>;
  pickFolder(): Promise<string | null>;
  listProjects(): Promise<Project[]>;
  openProject(repoPath: string, opts?: OpenOptions): Promise<WorkspaceSnapshot>;
  closeProject(): Promise<void>;
  updateProject(patch: ProjectPatch): Promise<Project>;
  snapshot(): Promise<WorkspaceSnapshot | null>;
  sendToBoss(text: string): Promise<void>;
  listRoles(): Promise<Role[]>;
  saveRole(role: Role): Promise<Role>;
  listSkills(): Promise<Skill[]>;
  saveSkill(skill: Skill): Promise<Skill>;
  hire(roleId: string, name?: string): Promise<Agent>;
  fireAgent(agentId: string): Promise<void>;
  agentLog(agentId: string): Promise<LogEntry[]>;
  messageAgent(agentId: string, text: string): Promise<void>;
  openWorktree(agentId: string): Promise<void>;
  pauseTask(id: string): Promise<void>;
  resumeTask(id: string): Promise<void>;
  cancelTask(id: string): Promise<void>;
  answerMerge(requestId: string, ok: boolean): Promise<void>;
  getSettings(): Promise<AppSettings>;
  saveSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  onEvent(cb: (e: WorkspaceEvent) => void): () => void;
}
