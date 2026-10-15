import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Agent, CommitDetail, CommitSummary, LogEntry, OpenOptions, Project, ProjectPatch, DeviceSupport, OpenProjectStatus, PreviewInput, PreviewTab, Role, Skill, Task, WorkspaceEvent, WorkspaceSnapshot } from '../../shared/types';
import { AgentManager, type ManagerEvent, type MergeOutcome, type MessageResult } from '../agents/agentManager';
import { applyUserEdit } from '../agents/projectSkills';
import { bossTools, type ToolDef } from '../agents/bossTools';
import { createClassifier } from '../agents/classifier';
import { BossSession } from '../boss/bossSession';
import { ClaudeRunner, type ClaudeRunnerOptions } from '../claude/runner';
import { WorktreeManager, inspectRepo, slugify } from '../git/worktrees';
import { McpHost } from '../mcp/mcpHost';
import { BrowserService } from '../browser/browserService';
import { DevServerService } from '../browser/devServers';
import { employeeTools } from '../browser/employeeTools';
import { previewRows } from '../browser/previewRows';
import { DeviceService } from '../devices/deviceService';
import { deviceTools } from '../devices/deviceTools';
import { detectDevices, resolveDeviceTools, type DeviceToolsOverride } from '../devices/tools';
import type { DeviceKind } from '../devices/drivers';

const deviceKindOf = (t: string | null): DeviceKind | null => (t === 'device:android' ? 'android' : t === 'device:ios' ? 'ios' : null);
import { AttachmentStore } from '../boss/attachments';
import type { DataPaths } from '../store/paths';
import { ProjectStore } from '../store/projectStore';
import { RoleStore } from '../store/roleStore';
import { SkillStore } from '../store/skillStore';
import { attachmentsSchema, parseOrThrow, projectPatchSchema, projectSkillsEditSchema } from '../store/validate';
import { ApprovalBroker } from './approvalBroker';
import { createRepo, type NewProjectInput } from './newProject';
import { killTree } from '../claude/killTree';
import { commitDetail, fileDiff, listBranches, listCommits } from '../git/history';
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
  /** Test hook: fake device tools. */
  deviceTools?: DeviceToolsOverride;
}

interface Workspace {
  project: Project;
  manager: AgentManager;
  host: McpHost;
  boss: BossSession;
  browser: BrowserService;
  devServers: DevServerService;
  /** The employees' tool server (browser and dev servers), one token per employee. */
  office: McpHost;
  attachments: AttachmentStore;
  devices: DeviceService;
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
  private supportCache: { at: number; value: Promise<DeviceSupport> } | null = null;
  /** The project in view. */
  private ws: Workspace | null = null;
  /** Every opened project, by id: they keep running when you switch (only close/quit stops them). */
  private running = new Map<string, Workspace>();
  private activityTimer: ReturnType<typeof setTimeout> | null = null;
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

  // ---------- history (read-only; always the open project's repo) ----------

  async historyBranches(): Promise<string[]> { return listBranches(this.mustWs().project.repoPath); }
  async historyList(ref: string, skip: number, mergesOnly: boolean): Promise<CommitSummary[]> { return listCommits(this.mustWs().project.repoPath, ref, { skip, mergesOnly }); }
  async historyCommit(sha: string): Promise<CommitDetail> { return commitDetail(this.mustWs().project.repoPath, sha); }
  async historyDiff(sha: string, file: string): Promise<string> { return fileDiff(this.mustWs().project.repoPath, sha, file); }

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
    const id = projectIdFor(info.root);
    // Already running (in the background or in view): just show it, nothing restarts.
    const already = this.running.get(id);
    if (already) {
      this.ws = already;
      this.activityChanged();
      return this.snapshot();
    }
    const existing = await this.store.getProject(id);
    const project: Project = existing ?? {
      id, name: path.basename(info.root), repoPath: info.root, baseBranch: info.branch, maxConcurrent: 4, autoMerge: false,
    };
    project.repoPath = info.root;
    await this.store.saveProject(project);

    // The tools need the boss session and the boss session needs the MCP config; `ws` closes the loop.
    let ws!: Workspace;
    // Employees' browser and dev servers, and the tool server they reach them through (one token per employee).
    let managerRef: AgentManager | null = null;
    const previewChanged = () => { if (ws) this.emitWs(ws, { type: 'preview-changed' }); };
    const devServers = new DevServerService({ cwdFor: (agentId) => managerRef?.agents().find((a) => a.id === agentId)?.worktreePath, onChange: previewChanged });
    const browser = new BrowserService({ onChange: previewChanged, onFrame: (f) => { if (ws && this.ws === ws) this.emit('preview-frame', f); } });
    const devices = new DeviceService({
      tools: resolveDeviceTools(process.env, process.platform, this.d.deviceTools),
      prefer: (kind) => (kind === 'android' ? project.androidDevice : project.iosDevice) || undefined,
      nameOf: (agentId) => managerRef?.findAgent(agentId)?.name ?? 'an employee',
      taskOf: (agentId) => managerRef?.tasks().find((t) => t.assigneeId === agentId && t.status === 'working')?.id,
      onChange: previewChanged,
      onFrame: (f) => { if (ws && this.ws === ws) this.emit('preview-frame', f); },
    });
    const worktreeOf = (agentId: string) => managerRef?.agents().find((a) => a.id === agentId)?.worktreePath;
    const office = new McpHost([...employeeTools({ browser, devServers }), ...deviceTools({ devices, worktreeOf })], 'office');
    await office.start();
    const employeeMcp = async (agent: Agent): Promise<string | null> => {
      if (project.browserTools === false) return null;
      const file = path.join(this.d.paths.projectDir(id), `mcp-${agent.id}.json`);
      await office.writeClientConfig(agent.id, office.addClient(agent.id), file);
      return file;
    };

    // From here on the employee tool server is listening: a failure before the workspace exists must close it.
    const abandon = async () => { await office.close(); await browser.close(); await devServers.close(); await devices.close(); };
    let manager!: AgentManager;
    let requeued: string[];
    let bossAgent!: Agent;
    const createRunner = (o: ClaudeRunnerOptions) => new ClaudeRunner({ ...o, binArgs: this.d.claudeBinArgs, env: this.d.claudeEnv ? { ...process.env, ...this.d.claudeEnv } : undefined });
    const isolate = this.isolate;
    try {
    await fs.mkdir(this.d.paths.promptDir, { recursive: true });
    manager = new AgentManager({
      project, store: this.store, roles: this.roles, skills: this.skills, worktrees: new WorktreeManager(info.root),
      createRunner, claudeBin: this.claudeBin, promptDir: this.d.paths.promptDir, isolateUserSettings: isolate,
      employeeMcp,
      classify: createClassifier({ createRunner, claudeBin: this.claudeBin, cwd: this.d.paths.promptDir, isolateUserSettings: isolate }),
    });
    managerRef = manager;
    requeued = await manager.load();
    if (opts.bossModel && !existing) {
      const bossRole = await this.roles.get('boss');
      if (bossRole) await this.roles.save({ ...bossRole, model: opts.bossModel });
    }
    bossAgent = await manager.createBoss(opts.bossName?.trim() || 'Max');
    project.bossId = bossAgent.id;
    await this.store.saveProject(project);
    } catch (err) {
      await manager?.shutdown().catch(() => undefined);
      await abandon();
      throw err;
    }

    const broker = new ApprovalBroker();
    const tools = bossTools({
      manager, roles: this.roles, project,
      requestMerge: (task) => this.requestMerge(ws, task),
      report: (text) => { void ws.boss.report(text); },
      rolesChanged: () => this.emitWs(ws, { type: 'roles-changed' }),
      skills: this.skills,
      saveProject: async () => { await this.store.saveProject(project); this.emitWs(ws, { type: 'project', project: { ...project } }); },
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
      await abandon();
      throw err;
    }
    const attachments = new AttachmentStore(this.d.paths.attachmentsDir(id));
    const boss = new BossSession({
      attachments, project, manager, roles: this.roles, skills: this.skills, store: this.store, createRunner,
      claudeBin: this.claudeBin, promptDir: this.d.paths.promptDir, mcpConfigPath, isolateUserSettings: isolate,
    });
    ws = { project, manager, host, boss, broker, tools, browser, devServers, office, attachments, devices, outcomes: new Map() };
    manager.on('event', (e: ManagerEvent) => this.forward(ws, e));
    boss.on('chat', (entry) => this.emitWs(ws, { type: 'chat', entry }));
    boss.on('stream', (text: string | null) => this.emitWs(ws, { type: 'boss-stream', text }));
    boss.on('busy', (busy: boolean) => this.emitWs(ws, { type: 'boss-busy', busy }));
    boss.start();
    this.running.set(id, ws);
    this.ws = ws;
    this.activityChanged();

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

  /** A message from the user, with optional attachments (checked here: they come from the renderer). */
  async sendToBoss(text: string, attachments?: unknown): Promise<void> {
    // Refused, not cut: a shortened brief would reach the boss without the user knowing.
    if (text.length > 100_000) throw new Error('The message is too long (at most 100,000 characters)');
    const files = attachments === undefined ? [] : parseOrThrow(attachmentsSchema, attachments, 'attachments');
    return this.mustWs().boss.send(text, files);
  }

  readAttachment(id: string): Promise<string> { return this.mustWs().attachments.readImage(id); }

  async updateProject(patch: unknown): Promise<Project> {
    const ws = this.mustWs();
    const clean: ProjectPatch = parseOrThrow(projectPatchSchema, patch, 'project settings');
    Object.assign(ws.project, clean);
    if (clean.browserTools === false) {
      // Turned off: nobody keeps a key, a tab, a dev server or a device.
      for (const a of ws.manager.agents()) {
        ws.office.removeClient(a.id);
        ws.devices.release(a.id);
        void ws.browser.closeFor(a.id);
        void ws.devServers.stop(a.id);
      }
    }
    await this.store.saveProject(ws.project);
    this.emitWs(ws, { type: 'project', project: { ...ws.project } });
    return { ...ws.project };
  }

  /** The user's edit to the project's skills; the boss is told and cannot undo the removals. */
  async setProjectSkills(edit: unknown): Promise<WorkspaceSnapshot> {
    const ws = this.mustWs();
    const clean = parseOrThrow(projectSkillsEditSchema, edit, 'project skills');
    const known = new Set((await this.skills.list()).map((s) => s.id));
    const next = applyUserEdit(ws.project, clean, known);
    Object.assign(ws.project, next);
    await this.store.saveProject(ws.project);
    this.emitWs(ws, { type: 'project', project: { ...ws.project } });
    const change = [...(clean.add ?? []).map((id) => `+${id}`), ...(clean.remove ?? []).map((id) => `−${id}`)].join(' ');
    if (change) void ws.boss.notify(`The user changed the project skills: ${change}. Respect these; you cannot re-add skills the user removed.`).catch(() => undefined);
    return this.snapshot();
  }

  previewAvailable(): Promise<boolean> { return this.mustWs().browser.available(); }
  /** Watch a browser tab (an employee id) or a device ('device:android' / 'device:ios'); null stops. */
  async previewWatch(target: string | null): Promise<void> {
    const ws = this.mustWs();
    const kind = deviceKindOf(target);
    ws.devices.watch(kind);
    await ws.browser.watch(kind ? null : target);
  }
  previewAck(): void { this.ws?.browser.ack(); this.ws?.devices.ack(); }
  async previewInput(target: string, e: PreviewInput): Promise<void> {
    const ws = this.mustWs();
    const kind = deviceKindOf(target);
    if (kind) await ws.devices.input(kind, e); else await ws.browser.input(target, e);
  }
  async previewDevice(kind: DeviceKind, action: 'start' | 'home' | 'back' | 'shutdown'): Promise<void> {
    const ws = this.mustWs();
    if (action === 'start') return ws.devices.startByUser(kind);
    if (action === 'shutdown') return ws.devices.shutdownByUser(kind);
    await ws.devices.input(kind, { kind: 'key', key: action === 'home' ? 'Home' : 'Escape' });
  }
  /** What mobile tooling is installed (cached for a minute; works without an open project). */
  async deviceSupport(): Promise<DeviceSupport> {
    if (!this.supportCache || Date.now() - this.supportCache.at > 60_000) {
      this.supportCache = { at: Date.now(), value: detectDevices(resolveDeviceTools(process.env, process.platform, this.d.deviceTools)) };
    }
    return this.supportCache.value;
  }
  async previewReload(agentId: string): Promise<void> { await this.mustWs().browser.reload(agentId); }
  async previewStopDevServer(agentId: string): Promise<void> { await this.mustWs().devServers.stop(agentId); }

  /** Employees' browser tabs and their dev servers, for the Preview tab. */
  async previewList(): Promise<PreviewTab[]> {
    const ws = this.mustWs();
    const support = await this.deviceSupport();
    const devices = (await ws.devices.states()).filter((s) => s.running || support[s.kind].ok).map((s): PreviewTab => ({ agentId: `device:${s.kind}`, url: '', title: '', devServer: null, device: s }));
    return [...previewRows(await ws.browser.tabs(), ws.devServers.all()), ...devices];
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

  /** Close the project in view (other projects keep running). */
  async close(): Promise<void> {
    const ws = this.ws;
    if (!ws) return;
    this.ws = null;
    await this.closeWorkspace(ws);
  }

  /** App quit: close every running project. */
  async closeAll(): Promise<void> {
    this.ws = null;
    await Promise.all([...this.running.values()].map((ws) => this.closeWorkspace(ws)));
    if (this.activityTimer) clearTimeout(this.activityTimer);
    this.activityTimer = null;
  }

  /** Every running project's activity, for the sidebar. */
  openProjects(): OpenProjectStatus[] {
    return [...this.running.values()].map((ws) => {
      const tasks = ws.manager.tasks();
      return {
        id: ws.project.id,
        working: tasks.filter((t) => t.status === 'working').length,
        needsYou: ws.broker.pending().length + tasks.filter((t) => t.status === 'needs_help').length,
      };
    });
  }

  /** At most once a second, whichever project changed (background ones too). */
  private activityChanged(): void {
    if (this.activityTimer) return;
    this.activityTimer = setTimeout(() => {
      this.activityTimer = null;
      this.emit('event', { type: 'open-projects', projects: this.openProjects() } satisfies WorkspaceEvent);
    }, 1000);
  }

  private async closeWorkspace(ws: Workspace): Promise<void> {
    this.running.delete(ws.project.id);
    this.activityChanged();
    ws.broker.rejectAll();
    await this.terminals?.kill(ws.project.id);
    await ws.boss.stop();
    await ws.manager.shutdown();
    await ws.devServers.close();
    await ws.browser.close();
    await ws.devices.close();
    await ws.office.close();
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
    this.activityChanged();
    return awaiting;
  }

  private onDecision(ws: Workspace, taskId: string, requestId: string, decision: Promise<boolean>): void {
    const done = decision.then(async (ok): Promise<MergeOutcome | null> => {
      // A closed workspace keeps its saved requests so they come back on the next open; a background one acts on the answer.
      if (!this.running.has(ws.project.id)) return null;
      this.activityChanged();
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
    if (e.type === 'tasks-changed' || e.type === 'task-finished' || e.type === 'agents-changed') this.activityChanged();
    switch (e.type) {
      case 'agents-changed': return this.emitWs(ws, { type: 'agents', agents: ws.manager.agents() });
      case 'tasks-changed':
      case 'task-finished': return this.emitWs(ws, { type: 'tasks', tasks: ws.manager.tasks() });
      case 'agent-event': return this.emitWs(ws, { type: 'agent-event', agentId: e.agentId, event: e.event, at: new Date().toISOString() });
      case 'error': return this.emitWs(ws, { type: 'error', message: e.message });
      // The session is over: its key to the browser and device tools stops working (a new session gets a new one).
      case 'work-ended': void ws.devServers.stop(e.agentId); ws.devices.release(e.agentId); ws.office.removeClient(e.agentId); return undefined;
      case 'fired': ws.devices.release(e.agentId); void ws.devServers.stop(e.agentId); void ws.browser.closeFor(e.agentId); ws.office.removeClient(e.agentId); return undefined;
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
