export type AgentStatus = 'idle' | 'thinking' | 'working' | 'waiting' | 'done' | 'error' | 'paused';
export type TaskStatus = 'queued' | 'working' | 'needs_help' | 'review' | 'done' | 'failed' | 'cancelled';
export type PermissionMode = 'acceptEdits' | 'default' | 'plan' | 'bypassPermissions';

export interface Look { hair: string; shirt: string; skin: string }

export interface Role {
  id: string;
  name: string;
  blurb: string;
  systemPrompt: string;
  skills: string[];
  model: string;
  permissionMode: PermissionMode;
  allowedTools: string[];
  look: Look;
}

export interface Skill { id: string; name: string; description: string; body: string }

export interface Agent {
  id: string;
  projectId: string;
  name: string;
  roleId: string;
  kind: 'boss' | 'employee';
  sessionId?: string;
  worktreePath?: string;
  status: AgentStatus;
  bubble: string;
}

export interface DiffStat { path: string; add: number; del: number }

export interface Task {
  id: string;
  projectId: string;
  title: string;
  brief: string;
  assigneeId: string;
  createdBy: 'boss' | 'user';
  status: TaskStatus;
  /** Paused by the user: stays queued until resumed. */
  held: boolean;
  /** How many times a session was started for this task. */
  attempts: number;
  branch: string;
  dependsOn: string[];
  resultSummary?: string;
  diffStat?: DiffStat[];
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  repoPath: string;
  baseBranch: string;
  bossId?: string;
  maxConcurrent: number;
  bossCanHire: boolean;
  autoMerge: boolean;
}

export type RunnerEvent =
  | { type: 'init'; sessionId: string; model: string }
  | { type: 'thinking' }
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; isError: boolean; preview: string }
  | { type: 'result'; ok: boolean; text: string; sessionId: string; costUsd: number; durationMs: number; numTurns: number }
  | { type: 'raw'; text: string }
  | { type: 'stderr'; text: string }
  | { type: 'exit'; code: number | null; signal: string | null };

export interface AppStatus {
  platform: string;
  claude: { path: string; version: string | null } | null;
}
