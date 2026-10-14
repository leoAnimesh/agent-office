import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Agent, Project, Role, Task, WorkspaceEvent, WorkspaceSnapshot } from '../../shared/types';
import { AgentManager, type ManagerEvent, type MergeOutcome } from '../agents/agentManager';
import { bossTools, type ToolDef } from '../agents/bossTools';
import { BossSession } from '../boss/bossSession';
import { ClaudeRunner, type ClaudeRunnerOptions } from '../claude/runner';
import { WorktreeManager, inspectRepo, slugify } from '../git/worktrees';
import { McpHost } from '../mcp/mcpHost';
import type { DataPaths } from '../store/paths';
import { ProjectStore } from '../store/projectStore';
import { RoleStore } from '../store/roleStore';
import { SkillStore } from '../store/skillStore';
import { ApprovalBroker } from './approvalBroker';

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

export class ProjectService extends EventEmitter {
  private readonly store: ProjectStore;
  private readonly roles: RoleStore;
  private readonly skills: SkillStore;
  private ws: Workspace | null = null;

  constructor(private readonly d: ProjectServiceDeps) {
    super();
    this.store = new ProjectStore(d.paths);
    this.roles = new RoleStore(d.paths.rolesDir);
    this.skills = new SkillStore(d.paths.skillsDir);
  }

  async init(): Promise<void> {
    await this.roles.seed(path.join(this.d.resourcesDir, 'roles'));
    await this.skills.seed(path.join(this.d.resourcesDir, 'skills'));
  }

  listProjects(): Promise<Project[]> { return this.store.listProjects(); }
  listRoles(): Promise<Role[]> { return this.roles.list(); }
  current(): Project | null { return this.ws?.project ?? null; }
  tools(): ToolDef[] { return this.mustWs().tools; }

  async open(repoPath: string, bossName = 'Max'): Promise<WorkspaceSnapshot> {
    const info = await inspectRepo(repoPath);
    await this.close();
    const id = projectIdFor(info.root);
    const project: Project = (await this.store.getProject(id)) ?? {
      id, name: path.basename(info.root), repoPath: info.root, baseBranch: info.branch, maxConcurrent: 4, bossCanHire: true, autoMerge: false,
    };
    project.repoPath = info.root;
    await this.store.saveProject(project);

    const createRunner = (o: ClaudeRunnerOptions) => new ClaudeRunner({ ...o, binArgs: this.d.claudeBinArgs, env: this.d.claudeEnv ? { ...process.env, ...this.d.claudeEnv } : undefined });
    const isolate = this.d.isolateUserSettings ?? true;
    const manager = new AgentManager({
      project, store: this.store, roles: this.roles, skills: this.skills, worktrees: new WorktreeManager(info.root),
      createRunner, claudeBin: this.d.claudeBin, promptDir: this.d.paths.promptDir, isolateUserSettings: isolate,
    });
    await manager.load();
    const bossAgent = await manager.createBoss(bossName);
    project.bossId = bossAgent.id;
    await this.store.saveProject(project);

    const broker = new ApprovalBroker();
    // The tools need the boss session and the boss session needs the MCP config; `ws` closes the loop.
    let ws!: Workspace;
    const tools = bossTools({
      manager, roles: this.roles, project,
      requestMerge: (task) => this.requestMerge(ws, task),
      report: (text) => { void ws.boss.report(text); },
    });
    const host = new McpHost(tools);
    await host.start();
    const mcpConfigPath = path.join(this.d.paths.projectDir(id), 'mcp.json');
    await host.writeConfig(mcpConfigPath);
    const boss = new BossSession({
      project, manager, roles: this.roles, skills: this.skills, store: this.store, createRunner,
      claudeBin: this.d.claudeBin, promptDir: this.d.paths.promptDir, mcpConfigPath, isolateUserSettings: isolate,
    });
    ws = { project, manager, host, boss, broker, tools };
    manager.on('event', (e: ManagerEvent) => this.forward(ws, e));
    boss.on('chat', (entry) => this.emitWs(ws, { type: 'chat', entry }));
    boss.start();
    this.ws = ws;
    return this.snapshot();
  }

  async snapshot(): Promise<WorkspaceSnapshot> {
    const ws = this.mustWs();
    return { project: { ...ws.project }, agents: ws.manager.agents(), tasks: ws.manager.tasks(), chat: await ws.boss.history(200), merges: ws.broker.pending() };
  }

  sendToBoss(text: string): Promise<void> { return this.mustWs().boss.send(text); }
  hire(roleId: string, name?: string): Promise<Agent> { return this.mustWs().manager.hire(roleId, name); }
  pauseTask(id: string): Promise<void> { return this.mustWs().manager.pauseTask(id); }
  resumeTask(id: string): Promise<void> { return this.mustWs().manager.resumeTask(id); }
  cancelTask(id: string): Promise<void> { return this.mustWs().manager.cancelTask(id); }

  async answerMerge(requestId: string, ok: boolean): Promise<void> {
    if (!this.mustWs().broker.answer(requestId, ok)) throw new Error('That merge request is no longer pending');
  }

  async close(): Promise<void> {
    const ws = this.ws;
    if (!ws) return;
    this.ws = null;
    ws.broker.rejectAll();
    await ws.boss.stop();
    await ws.manager.shutdown();
    await ws.host.close();
  }

  private async requestMerge(ws: Workspace, task: Task): Promise<unknown> {
    if (ws.project.autoMerge) return ws.manager.merge(task.id);
    const agentName = ws.manager.findAgent(task.assigneeId)?.name ?? 'unknown';
    const { requestId, decision } = ws.broker.request({
      taskId: task.id, title: task.title, agentName, diffStat: task.diffStat ?? [], summary: task.resultSummary ?? '',
    });
    this.emitWs(ws, { type: 'merge-request', request: ws.broker.pending().find((r) => r.requestId === requestId)! });
    void decision.then(async (ok) => {
      if (this.ws !== ws) return;
      this.emitWs(ws, { type: 'merge-resolved', requestId });
      if (!ok) return ws.boss.notify(`The user declined to merge ${task.id}.`, task.id);
      const outcome = await ws.manager.merge(task.id).catch((e: unknown) => ({ status: 'blocked' as const, reason: e instanceof Error ? e.message : String(e) }));
      return ws.boss.notify(describeMerge(task.id, outcome), task.id);
    }).catch(() => undefined);
    return { status: 'awaiting_user_approval', note: 'The user has been asked. You will get an [AgentOffice] message with the outcome.' };
  }

  private forward(ws: Workspace, e: ManagerEvent): void {
    switch (e.type) {
      case 'agents-changed': return this.emitWs(ws, { type: 'agents', agents: ws.manager.agents() });
      case 'tasks-changed':
      case 'task-finished': return this.emitWs(ws, { type: 'tasks', tasks: ws.manager.tasks() });
      case 'agent-event': return this.emitWs(ws, { type: 'agent-event', agentId: e.agentId, event: e.event });
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
