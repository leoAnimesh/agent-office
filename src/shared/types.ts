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

export interface Skill { id: string; name: string; description: string; body: string; tags: string[] }

/** A skill every employee on the project gets. The user's own choices win over the boss's. */
export interface ProjectSkill { id: string; reason: string; addedBy: 'boss' | 'user' }
export const MAX_PROJECT_SKILLS = 12;

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

/** One commit in the History view: numbers are what it brought in (a merge counts against its first parent). */
export interface CommitSummary { sha: string; short: string; subject: string; author: string; date: string; isMerge: boolean; taskId: string | null; files: number; add: number; del: number }
export interface CommitDetail { sha: string; subject: string; body: string; author: string; email: string; date: string; parents: number; taskId: string | null; files: DiffStat[] }

/** Role model value meaning "let the classifier pick per task". */
export const AUTO_MODEL = 'auto';
export type TaskSize = 'small' | 'medium' | 'large';
export interface ModelPick { model: string; size?: TaskSize; reason: string; source: 'classifier' | 'role' | 'fallback' }

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
  /** Model the task runs on; undefined while the classifier is still deciding. */
  model?: string;
  modelPick?: ModelPick;
  /** The commit that merged this task into the base branch (shown in History). */
  mergeCommit?: string;
  /** Position in the queue set by the user; unset tasks come after, oldest first. */
  order?: number;
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
  autoMerge: boolean;
  /** Skills every employee on the project gets; undefined until the boss or the user first picks. */
  skills?: ProjectSkill[];
  /** Skills the user removed; the boss cannot add them back. */
  skillsExcluded?: string[];
  /** Employees get the browser tools (undefined = on). */
  browserTools?: boolean;
  /** Preferred Android emulator (AVD name) and iOS simulator (UDID); automatic when unset. */
  androidDevice?: string;
  iosDevice?: string;
}

export type RunnerEvent =
  | { type: 'init'; sessionId: string; model: string }
  | { type: 'thinking' }
  | { type: 'text'; text: string }
  | { type: 'text_delta'; text: string }
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

/** An image or file sent with a chat message; the bytes live under the project's attachments folder. */
export interface AttachmentMeta { id: string; name: string; mime: string; size: number; kind: 'image' | 'file' }
/** An attachment on its way from the chat box to main. */
export interface NewAttachment { name: string; mime: string; data: Uint8Array }

export type ChatEntry =
  | { kind: 'user'; at: string; text: string; attachments?: AttachmentMeta[] }
  | { kind: 'boss'; at: string; text: string }
  | { kind: 'tool'; at: string; tool: string; input: Record<string, unknown> }
  | { kind: 'event'; at: string; text: string; taskId?: string; files?: DiffStat[] }
  | { kind: 'report'; at: string; text: string }
  | { kind: 'error'; at: string; text: string };

export interface MergeRequest {
  requestId: string;
  taskId: string;
  title: string;
  agentName: string;
  diffStat: DiffStat[];
  summary: string;
}

export interface WorkspaceSnapshot {
  project: Project;
  agents: Agent[];
  tasks: Task[];
  chat: ChatEntry[];
  merges: MergeRequest[];
}

export type WorkspaceEvent =
  | { type: 'roles-changed' }
  | { type: 'preview-changed' }
  | { type: 'agents'; agents: Agent[] }
  | { type: 'tasks'; tasks: Task[] }
  | { type: 'chat'; entry: ChatEntry }
  | { type: 'boss-stream'; text: string | null }
  | { type: 'boss-busy'; busy: boolean }
  | { type: 'agent-event'; agentId: string; event: RunnerEvent; at: string }
  | { type: 'project'; project: Project }
  | { type: 'merge-request'; request: MergeRequest }
  | { type: 'merge-resolved'; requestId: string }
  | { type: 'error'; message: string };

/** Output from, or the exit of, the open project's terminal. */
export type TerminalEvent =
  | { type: 'data'; projectId: string; data: string }
  | { type: 'exit'; projectId: string; exitCode: number };

export interface AppSettings { claudePath: string | null; isolateUserSettings: boolean; autoModelMigrated?: boolean; allToolsMigrated?: boolean }
export interface ProjectPatch { maxConcurrent?: number; autoMerge?: boolean; browserTools?: boolean; androidDevice?: string; iosDevice?: string }
export interface OpenOptions { bossName?: string; bossModel?: string }
export interface CreateProjectInput extends OpenOptions { parentDir: string; name: string; brief?: string }
export interface LogEntry { at: string; event: RunnerEvent }

/** A device shown in the Preview tab (rows with agentId 'device:android' / 'device:ios'). */
export interface PreviewDevice { kind: 'android' | 'ios'; running: boolean; name: string | null; holder: string | null; startedByApp: boolean; canInput: boolean }
export interface PreviewTab { agentId: string; url: string; title: string; devServer: { url: string; running: boolean } | null; device?: PreviewDevice }
/** What mobile tooling this machine has. */
export interface DeviceSupport {
  android: { ok: boolean; avds: string[]; reason?: string };
  ios: { ok: boolean; devices: { udid: string; name: string; runtime: string; state: string }[]; idb: boolean; reason?: string };
}
export interface PreviewFrame { agentId: string; data: string; width: number; height: number; mime?: string }
export type PreviewInput =
  | { kind: 'click'; x: number; y: number; button: 'left' | 'right' }
  | { kind: 'wheel'; x: number; y: number; dy: number }
  | { kind: 'key'; key: string }
  | { kind: 'text'; text: string };

/** Shown when no browser can start for the team (the app cannot download one in packaged builds). */
export const NO_BROWSER = 'No browser found. Install Google Chrome or Microsoft Edge, then try again.';
