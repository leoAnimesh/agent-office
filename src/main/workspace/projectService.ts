import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Agent, LogEntry, OpenOptions, Project, ProjectPatch, Role, Skill, Task, WorkspaceEvent, WorkspaceSnapshot } from '../../shared/types';
import { AgentManager, type ManagerEvent, type MergeOutcome, type MessageResult } from '../agents/agentManager';
import { bossTools, type ToolDef } from '../agents/bossTools';
import { createClassifier } from '../agents/classifier';
import { BossSession } from '../boss/bossSession';
import { ClaudeRunner, type ClaudeRunnerOptions } from '../claude/runner';
import { WorktreeManager, inspectRepo, slugify } from '../git/worktrees';
import { McpHost } from '../mcp/mcpHost';
import type { DataPaths } from '../store/paths';
import { ProjectStore } from '../store/projectStore';
import { RoleStore } from '../store/roleStore';
import { SkillStore } from '../store/skillStore';
import { parseOrThrow, projectPatchSchema } from '../store/validate';
import { ApprovalBroker } from './approvalBroker';
import { createRepo, type NewProjectInput } from './newProject';
import { killTree } from '../claude/killTree';
import { loadSpawnPty } from '../terminal/pty';
import { TerminalService, type TerminalEvent } from '../terminal/terminalService';

export interface ProjectServiceDeps {
  paths: DataPaths;
  resourcesDir: string;
  claudeBin: string;
  claudeBinArgs?: string[];
  /** Read each time a runner is created. */
  claudeEnv?: NodeJS.ProcessEnv;
  isolateUserSettings?: boolean;
}

interface Workspace {
  project: Project;
  manager: AgentManager;
  host: McpHost;
  boss: BossSession;
  broker: ApprovalBroker;
  tools: ToolDef[];
  /** What each answered approval card led to (null when declined or dropped), so mergeNow can report failures. */
  outcomes: Map<string, Promise<MergeOutcome | null>>;
}

export function projectIdFor(root: string): string {
  const resolved = path.resolve(root);
  return `${slugify(path.basename(resolved), 'project')}-${createHash('sha1').update(resolved).digest('hex').slice(0, 8)}`;
}

function describeMerge(taskId: string, r: MergeOutcome): string {
  switch (r.status) {
    case 'merged': return `Merge of ${taskId}: merged into the main branch.`;
    case 'conflict': return `Merge of ${taskId}: conflict in ${r.files.join(', ')}. The branch was left as it was; ask the employee to rebase on the main branch and resolve it.`;
    case 'blocked': return `Merge of ${taskId}: blocked. ${r.reason}`;
    case 'not_ready': return `Merge of ${taskId}: not ready. ${r.reason}`;
  }
}

export function isInside(child: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export class ProjectService extends EventEmitter {
  private readonly store: ProjectStore;
  private readonly roles: RoleStore;
  private readonly skills: SkillStore;
  private ws: Workspace | null = null;
  /** The open project's terminal; null when the native PTY could not load on this machine. */
  private terminals: TerminalService | null = null;
  private terminalError = '';
  private claudeBin: string;
  private isolate: boolean;

  constructor(private readonly d: ProjectServiceDeps) {
    super();
    this.claudeBin = d.claudeBin;
    this.isolate = d.isolateUserSettings ?? true;
    this.store = new ProjectStore(d.paths);
    this.roles = new RoleStore(d.paths.rolesDir);
    this.skills = new SkillStore(d.paths.skillsDir);
  }

  async init(): Promise<void> {
    await this.roles.seed(path.join(this.d.resourcesDir, 'roles'));
    await this.skills.seed(path.join(this.d.resourcesDir, 'skills'));
    try {
      this.terminals = new TerminalService({ spawn: await loadSpawnPty(), killTree: (pid, signal) => killTree(pid, process.platform, signal) });
      this.terminals.on('event', (e: TerminalEvent) => this.emit('terminal', e));
    } catch (e) {
      this.terminalError = e instanceof Error ? e.message : String(e);
      console.warn(`Terminal unavailable: ${this.terminalError}`);
    }
  }

  // ---------- terminal (always the open project's folder; the renderer never names a path) ----------

  async terminalOpen(cols: number, rows: number): Promise<{ backlog: string }> {
    const { ws, t } = this.mustTerminal();
    return t.open(ws.project.id, ws.project.repoPath, cols, rows);
  }

  async terminalRestart(cols: number, rows: number): Promise<{ backlog: string }> {
    const { ws, t } = this.mustTerminal();
    return t.restart(ws.project.id, ws.project.repoPath, cols, rows);
  }

  terminalWrite(data: string): void {
    if (this.ws) this.terminals?.write(this.ws.project.id, data);
  }

  terminalResize(cols: number, rows: number): void {
    if (this.ws) this.terminals?.resize(this.ws.project.id, cols, rows);
  }

  terminalSessions(): number { return this.terminals?.size ?? 0; }

  private mustTerminal(): { ws: Workspace; t: TerminalService } {
    if (!this.ws) throw new Error('Open a project first');
    if (!this.terminals) throw new Error(`Terminal unavailable: ${this.terminalError}`);
    return { ws: this.ws, t: this.terminals };
  }

  listProjects(): Promise<Project[]> { return this.store.listProjects(); }
  listRoles(): Promise<Role[]> { return this.roles.list(); }
  current(): Project | null { return this.ws?.project ?? null; }
  tools(): ToolDef[] { return this.mustWs().tools; }

  /** Applies to sessions started from now on. */
  configure(o: { claudeBin?: string; isolateUserSettings?: boolean }): void {
    if (o.claudeBin) this.claudeBin = o.claudeBin;
    if (o.isolateUserSettings !== undefined) this.isolate = o.isolateUserSettings;
  }

  /** Start a project from scratch: new git repo, open it, and give the boss the brief as the first message. */
  async create(input: NewProjectInput & OpenOptions): Promise<WorkspaceSnapshot> {
    const dir = await createRepo(input);
    await this.open(dir, input);
    const brief = input.brief?.trim();
    if (brief) await this.sendToBoss(brief);
    return this.snapshot();
  }

  async open(repoPath: string, opts: OpenOptions = {}): Promise<WorkspaceSnapshot> {
    const info = await inspectRepo(repoPath);
    await this.close();
    const id = projectIdFor(info.root);
    const existing = await this.store.getProject(id);
    const project: Project = existing ?? {
      id, name: path.basename(info.root), repoPath: info.root, baseBranch: info.branch, maxConcurrent: 4, autoMerge: false,
    };
    project.repoPath = info.root;
    await this.store.saveProject(project);

    const createRunner = (o: ClaudeRunnerOptions) => new ClaudeRunner({ ...o, binArgs: this.d.claudeBinArgs, env: this.d.claudeEnv ? { ...process.env, ...this.d.claudeEnv } : undefined });
    const isolate = this.isolate;
    await fs.mkdir(this.d.paths.promptDir, { recursive: true });
    const manager = new AgentManager({
      project, store: this.store, roles: this.roles, skills: this.skills, worktrees: new WorktreeManager(info.root),
      createRunner, claudeBin: this.claudeBin, promptDir: this.d.paths.promptDir, isolateUserSettings: isolate,
      classify: createClassifier({ createRunner, claudeBin: this.claudeBin, cwd: this.d.paths.promptDir, isolateUserSettings: isolate }),
    });
    const requeued = await manager.load();
    if (opts.bossModel && !existing) {
      const bossRole = await this.roles.get('boss');
      if (bossRole) await this.roles.save({ ...bossRole, model: opts.bossModel });
    }
    const bossAgent = await manager.createBoss(opts.bossName?.trim() || 'Max');
    project.bossId = bossAgent.id;
    await this.store.saveProject(project);

    const broker = new ApprovalBroker();
    // The tools need the boss session and the boss session needs the MCP config; `ws` closes the loop.
    let ws!: Workspace;
    const tools = bossTools({
      manager, roles: this.roles, project,
      requestMerge: (task) => this.requestMerge(ws, task),
      report: (text) => { void ws.boss.report(text); },
      rolesChanged: () => this.emitWs(ws, { type: 'roles-changed' }),
    });
    const host = new McpHost(tools);
    await host.start();
    const mcpConfigPath = path.join(this.d.paths.projectDir(id), 'mcp.json');
    try {
      await host.writeConfig(mcpConfigPath);
    } catch (err) {
      // Never leave a listening MCP server or a live manager behind a failed open.
      await host.close();
      await manager.shutdown();
      throw err;
    }
    const boss = new BossSession({
      project, manager, roles: this.roles, skills: this.skills, store: this.store, createRunner,
      claudeBin: this.claudeBin, promptDir: this.d.paths.promptDir, mcpConfigPath, isolateUserSettings: isolate,
    });
    ws = { project, manager, host, boss, broker, tools, outcomes: new Map() };
    manager.on('event', (e: ManagerEvent) => this.forward(ws, e));
    boss.on('chat', (entry) => this.emitWs(ws, { type: 'chat', entry }));
    boss.on('stream', (text: string | null) => this.emitWs(ws, { type: 'boss-stream', text }));
    boss.on('busy', (busy: boolean) => this.emitWs(ws, { type: 'boss-busy', busy }));
    boss.start();
    this.ws = ws;

    // Re-show merge approvals that were pending when the app last stopped.
    for (const r of await this.store.getPendingMerges(id)) {
      if (ws.manager.getTask(r.taskId)?.status !== 'review') continue;
      const { decision } = ws.broker.request(r, r.requestId);
      this.onDecision(ws, r.taskId, r.requestId, decision);
    }
    await this.savePending(ws);

    // Resume work that was interrupted, and tell the boss about it.
    await manager.pump();
    if (requeued.length > 0) {
      const list = requeued.join(', ');
      // Work is not lost: the worktree keeps the files and the agent resumes its saved conversation with a
      // "continue from where you left off" message. Say so, or the boss tells the user it started over.
      const one = requeued.length === 1;
      void boss.notify(`The app restarted while ${list} ${one ? 'was' : 'were'} running. ${one ? 'Its' : 'Their'} work was kept (files and the agent's conversation), and ${one ? 'it has' : 'they have'} picked up where ${one ? 'it' : 'they'} left off.`);
    }
    return this.snapshot();
  }

  async snapshot(): Promise<WorkspaceSnapshot> {
    const ws = this.mustWs();
    return { project: { ...ws.project }, agents: ws.manager.agents(), tasks: ws.manager.tasks(), chat: await ws.boss.history(200), merges: ws.broker.pending() };
  }

  sendToBoss(text: string): Promise<void> { return this.mustWs().boss.send(text); }

  async updateProject(patch: unknown): Promise<Project> {
    const ws = this.mustWs();
    const clean: ProjectPatch = parseOrThrow(projectPatchSchema, patch, 'project settings');
    Object.assign(ws.project, clean);
    await this.store.saveProject(ws.project);
    this.emitWs(ws, { type: 'project', project: { ...ws.project } });
    return { ...ws.project };
  }

  listSkills(): Promise<Skill[]> { return this.skills.list(); }

  fire(agentId: string): Promise<void> { return this.mustWs().manager.fire(agentId); }
  messageAgent(ref: string, text: string): Promise<MessageResult> { return this.mustWs().manager.messageAgent(ref, text); }

  async agentLog(agentId: string, limit = 300): Promise<LogEntry[]> {
    const ws = this.mustWs();
    const raw = (await this.store.readLog(ws.project.id, agentId, limit)) as { at?: unknown; event?: unknown }[];
    return raw.filter((r): r is LogEntry => typeof r.at === 'string' && typeof r.event === 'object' && r.event !== null);
  }

  worktreeFor(agentId: string): string {
    const ws = this.mustWs();
    const agent = ws.manager.findAgent(agentId);
    const wt = agent?.worktreePath;
    const root = path.join(ws.project.repoPath, '.agentoffice', 'wt');
    if (!agent || !wt) throw new Error(`${agent?.name ?? 'That agent'} has no worktree yet`);
    if (!isInside(wt, root)) throw new Error('Refusing to open a folder outside the project worktrees');
    return wt;
  }
  hire(roleId: string, name?: string): Promise<Agent> { return this.mustWs().manager.hire(roleId, name); }
  pauseTask(id: string): Promise<void> { return this.mustWs().manager.pauseTask(id); }
  resumeTask(id: string): Promise<void> { return this.mustWs().manager.resumeTask(id); }
  cancelTask(id: string): Promise<void> { return this.mustWs().manager.cancelTask(id); }
  moveTask(id: string, beforeId: string | null): Promise<void> { return this.mustWs().manager.moveTask(id, beforeId); }

  async reassignTask(id: string, agent: string): Promise<void> {
    const ws = this.mustWs();
    const t = await ws.manager.reassignTask(id, agent);
    void ws.boss.notify(`The user handed ${id} to ${ws.manager.findAgent(t.assigneeId)?.name ?? agent}.`, id).catch(() => undefined);
  }

  /** The user merges from the board: they are the approver, so no approval card (a pending one is answered instead). */
  async mergeNow(id: string): Promise<void> {
    const ws = this.mustWs();
    const pending = ws.broker.pending().find((r) => r.taskId === id);
    if (pending) {
      // Answer the card (its own flow merges and tells the boss), then surface a failed merge to the user.
      const outcome = ws.outcomes.get(pending.requestId);
      ws.broker.answer(pending.requestId, true);
      const r = outcome ? await outcome : null;
      if (r && r.status !== 'merged') throw new Error(describeMerge(id, r));
      return;
    }
    const outcome = await ws.manager.merge(id);
    const told = describeMerge(id, outcome);
    if (outcome.status !== 'merged') {
      void ws.boss.notify(`The user tried to merge ${id}. ${told}`, id).catch(() => undefined);
      throw new Error(told);
    }
    void ws.boss.notify(`The user merged ${id}. ${told}`, id).catch(() => undefined);
  }

  async answerMerge(requestId: string, ok: boolean): Promise<void> {
    if (!this.mustWs().broker.answer(requestId, ok)) throw new Error('That merge request is no longer pending');
  }

  async close(): Promise<void> {
    const ws = this.ws;
    if (!ws) return;
    this.ws = null;
    ws.broker.rejectAll();
    await this.terminals?.kill(ws.project.id);
    await ws.boss.stop();
    await ws.manager.shutdown();
    await ws.host.close();
  }

  private async requestMerge(ws: Workspace, task: Task): Promise<unknown> {
    const awaiting = { status: 'awaiting_user_approval', note: 'The user has been asked. You will get an [AgentOffice] message with the outcome.' };
    if (task.status !== 'review') return { status: 'not_ready', reason: `Task ${task.id} is ${task.status}, not waiting for review.` };
    if (ws.project.autoMerge) return ws.manager.merge(task.id);
    if (ws.broker.pending().some((r) => r.taskId === task.id)) return awaiting;
    const agentName = ws.manager.findAgent(task.assigneeId)?.name ?? 'unknown';
    const { requestId, decision } = ws.broker.request({
      taskId: task.id, title: task.title, agentName, diffStat: task.diffStat ?? [], summary: task.resultSummary ?? '',
    });
    this.onDecision(ws, task.id, requestId, decision);
    await this.savePending(ws);
    this.emitWs(ws, { type: 'merge-request', request: ws.broker.pending().find((r) => r.requestId === requestId)! });
    return awaiting;
  }

  private onDecision(ws: Workspace, taskId: string, requestId: string, decision: Promise<boolean>): void {
    const done = decision.then(async (ok): Promise<MergeOutcome | null> => {
      // A closed workspace keeps its saved requests so they come back on the next open.
      if (this.ws !== ws) return null;
      await this.savePending(ws);
      this.emitWs(ws, { type: 'merge-resolved', requestId });
      if (!ok) { await ws.boss.notify(`The user declined to merge ${taskId}.`, taskId); return null; }
      const outcome: MergeOutcome = await ws.manager.merge(taskId).catch((e: unknown) => ({ status: 'blocked' as const, reason: e instanceof Error ? e.message : String(e) }));
      await ws.boss.notify(describeMerge(taskId, outcome), taskId);
      return outcome;
    }).catch(() => null);
    ws.outcomes.set(requestId, done);
    void done.finally(() => ws.outcomes.delete(requestId));
  }

  private savePending(ws: Workspace): Promise<void> {
    return this.store.savePendingMerges(ws.project.id, ws.broker.pending()).catch(() => undefined);
  }

  private forward(ws: Workspace, e: ManagerEvent): void {
    switch (e.type) {
      case 'agents-changed': return this.emitWs(ws, { type: 'agents', agents: ws.manager.agents() });
      case 'tasks-changed':
      case 'task-finished': return this.emitWs(ws, { type: 'tasks', tasks: ws.manager.tasks() });
      case 'agent-event': return this.emitWs(ws, { type: 'agent-event', agentId: e.agentId, event: e.event, at: new Date().toISOString() });
      case 'error': return this.emitWs(ws, { type: 'error', message: e.message });
      default: return undefined;
    }
  }

  private emitWs(ws: Workspace, e: WorkspaceEvent): void {
    if (this.ws === ws) this.emit('event', e);
  }

  private mustWs(): Workspace {
    if (!this.ws) throw new Error('No project is open');
    return this.ws;
  }
}
