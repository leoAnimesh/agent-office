import type { Agent, AppSettings, AppStatus, CreateProjectInput, LogEntry, OpenOptions, Project, ProjectPatch, Role, Skill, WorkspaceEvent, WorkspaceSnapshot, TerminalEvent } from './types';

export const IPC = {
  appStatus: 'app:status',
  openExternal: 'app:open-external',
  pickFolder: 'project:pick-folder',
  listProjects: 'project:list',
  openProject: 'project:open',
  createProject: 'project:create',
  defaultProjectsDir: 'project:default-dir',
  closeProject: 'project:close',
  updateProject: 'project:update',
  snapshot: 'project:snapshot',
  sendToBoss: 'boss:send',
  listRoles: 'team:roles',
  listSkills: 'team:skills',
  hire: 'team:hire',
  fireAgent: 'team:fire',
  agentLog: 'agent:log',
  messageAgent: 'agent:message',
  openWorktree: 'agent:open-worktree',
  pauseTask: 'task:pause',
  resumeTask: 'task:resume',
  cancelTask: 'task:cancel',
  moveTask: 'task:move',
  reassignTask: 'task:reassign',
  mergeNow: 'task:merge-now',
  answerMerge: 'merge:answer',
  getSettings: 'settings:get',
  saveSettings: 'settings:save',
  event: 'workspace:event',
  terminalOpen: 'terminal:open',
  terminalWrite: 'terminal:write',
  terminalResize: 'terminal:resize',
  terminalRestart: 'terminal:restart',
  terminalEvent: 'terminal:event',
} as const;

export interface AgentOfficeApi {
  getStatus(): Promise<AppStatus>;
  openExternal(url: string): Promise<void>;
  pickFolder(): Promise<string | null>;
  listProjects(): Promise<Project[]>;
  openProject(repoPath: string, opts?: OpenOptions): Promise<WorkspaceSnapshot>;
  createProject(input: CreateProjectInput): Promise<WorkspaceSnapshot>;
  defaultProjectsDir(): Promise<string>;
  closeProject(): Promise<void>;
  updateProject(patch: ProjectPatch): Promise<Project>;
  snapshot(): Promise<WorkspaceSnapshot | null>;
  sendToBoss(text: string): Promise<void>;
  listRoles(): Promise<Role[]>;
  listSkills(): Promise<Skill[]>;
  hire(roleId: string, name?: string): Promise<Agent>;
  fireAgent(agentId: string): Promise<void>;
  agentLog(agentId: string): Promise<LogEntry[]>;
  messageAgent(agentId: string, text: string): Promise<void>;
  openWorktree(agentId: string): Promise<void>;
  pauseTask(id: string): Promise<void>;
  resumeTask(id: string): Promise<void>;
  cancelTask(id: string): Promise<void>;
  /** Put a queued task before `beforeId` in the queue, or last when null. */
  moveTask(id: string, beforeId: string | null): Promise<void>;
  /** Hand a queued, unstarted task to another employee. */
  reassignTask(id: string, agent: string): Promise<void>;
  /** Merge a reviewed task now; the user is the approver. */
  mergeNow(id: string): Promise<void>;
  answerMerge(requestId: string, ok: boolean): Promise<void>;
  getSettings(): Promise<AppSettings>;
  saveSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  onEvent(cb: (e: WorkspaceEvent) => void): () => void;
  /** The open project's terminal: start it (or get its recent output back), type into it, resize, restart. */
  terminalOpen(cols: number, rows: number): Promise<{ backlog: string }>;
  terminalWrite(data: string): Promise<void>;
  terminalResize(cols: number, rows: number): Promise<void>;
  terminalRestart(cols: number, rows: number): Promise<{ backlog: string }>;
  onTerminal(cb: (e: TerminalEvent) => void): () => void;
}
