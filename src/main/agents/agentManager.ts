import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Agent, Project, RunnerEvent, Task, TaskStatus } from '../../shared/types';
import type { AgentRunner, ClaudeRunnerOptions } from '../claude/runner';
import { reduceStatus } from '../claude/status';
import { WorktreeManager, slugify } from '../git/worktrees';
import type { ProjectStore } from '../store/projectStore';
import { nextTaskId } from '../store/projectStore';
import type { RoleStore } from '../store/roleStore';
import type { SkillStore } from '../store/skillStore';
import { renderPrompt, taskMessage } from './prompt';
import { assertTransition, runnableTasks } from './taskRules';

export interface AgentManagerDeps {
  project: Project;
  store: ProjectStore;
  roles: RoleStore;
  skills: SkillStore;
  worktrees: WorktreeManager;
  createRunner: (o: ClaudeRunnerOptions) => AgentRunner;
  claudeBin: string;
  promptDir: string;
  isolateUserSettings: boolean;
  now?: () => Date;
}

export type ManagerEvent =
  | { type: 'agent-event'; agentId: string; event: RunnerEvent }
  | { type: 'agents-changed' }
  | { type: 'tasks-changed' }
  | { type: 'task-finished'; task: Task; agent: Agent }
  | { type: 'error'; message: string };

export interface NewTask { assignee: string; title: string; brief: string; dependsOn?: string[]; createdBy: 'boss' | 'user' }

interface Live { runner: AgentRunner; taskId: string }

const NAME_POOL = ['Pixel', 'Byte', 'Quinn', 'Ivy', 'Nova', 'Rex', 'Juno', 'Sage', 'Kit', 'Ziggy', 'Milo', 'Tess'];
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class AgentManager extends EventEmitter {
  private agentList: Agent[] = [];
  private taskList: Task[] = [];
  private live = new Map<string, Live>();
  /** All mutations run one at a time through this chain. */
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly d: AgentManagerDeps) {
    super();
  }

  // ---------- reads ----------

  agents(): Agent[] { return this.agentList.map((a) => ({ ...a })); }
  tasks(): Task[] { return this.taskList.map((t) => ({ ...t })); }

  findAgent(ref: string): Agent | undefined {
    const r = ref.trim().toLowerCase();
    return this.agentList.find((a) => a.id === ref || a.name.toLowerCase() === r);
  }

  // ---------- lifecycle ----------

  async load(): Promise<void> {
    this.agentList = await this.d.store.getAgents(this.d.project.id);
    this.taskList = await this.d.store.getTasks(this.d.project.id);
    for (const a of this.agentList) { a.status = 'idle'; a.bubble = 'Idle'; }
    let changed = false;
    for (const t of this.taskList) {
      if (t.status === 'working') { t.status = 'queued'; t.updatedAt = this.now(); changed = true; }
    }
    if (changed) await this.saveTasks();
  }

  idle(): Promise<void> { return this.chain; }

  async shutdown(): Promise<void> {
    for (const { runner } of this.live.values()) runner.stop();
    await this.chain;
  }

  // ---------- commands ----------

  createBoss(name: string): Promise<Agent> {
    return this.run(async () => {
      const existing = this.agentList.find((a) => a.kind === 'boss');
      if (existing) return { ...existing };
      const boss: Agent = { id: randomUUID(), projectId: this.d.project.id, name: name.trim() || 'Max', roleId: 'boss', kind: 'boss', status: 'idle', bubble: 'Idle' };
      this.agentList.push(boss);
      await this.saveAgents();
      return { ...boss };
    });
  }

  hire(roleId: string, name?: string): Promise<Agent> {
    return this.run(async () => {
      const role = await this.d.roles.get(roleId);
      if (!role) throw new Error(`Unknown role: ${roleId}`);
      const taken = new Set(this.agentList.map((a) => a.name.toLowerCase()));
      const finalName = name?.trim() || NAME_POOL.find((n) => !taken.has(n.toLowerCase())) || `${role.name} ${this.agentList.length + 1}`;
      if (taken.has(finalName.toLowerCase())) throw new Error(`An agent named ${finalName} already exists`);
      // Worktrees and branches are keyed by slug, so two employees must never share one.
      const clash = this.agentList.find((a) => a.kind === 'employee' && slugify(a.name) === slugify(finalName));
      if (clash) throw new Error(`The name ${finalName} is too similar to ${clash.name}; pick a more distinct name`);
      const agent: Agent = { id: randomUUID(), projectId: this.d.project.id, name: finalName, roleId, kind: 'employee', status: 'idle', bubble: 'Idle' };
      this.agentList.push(agent);
      await this.saveAgents();
      return { ...agent };
    });
  }

  async createTask(input: NewTask): Promise<Task> {
    const task = await this.run(async () => {
      const agent = this.findAgent(input.assignee);
      if (!agent || agent.kind !== 'employee') throw new Error(`No employee named ${input.assignee}`);
      for (const dep of input.dependsOn ?? []) {
        if (!this.taskList.some((t) => t.id === dep)) throw new Error(`Unknown task ${dep}`);
      }
      const id = nextTaskId(this.taskList);
      const now = this.now();
      const t: Task = {
        id, projectId: this.d.project.id, title: input.title.trim(), brief: input.brief, assigneeId: agent.id, createdBy: input.createdBy,
        status: 'queued', held: false, attempts: 0, branch: `ao/${slugify(agent.name)}/${slugify(input.title, 'task')}-${id.toLowerCase()}`,
        dependsOn: input.dependsOn ?? [], createdAt: now, updatedAt: now,
      };
      this.taskList.push(t);
      await this.saveTasks();
      return { ...t };
    });
    await this.pump();
    return task;
  }

  pump(): Promise<void> {
    return this.run(async () => {
      for (const t of runnableTasks(this.taskList, new Set(this.live.keys()), this.d.project.maxConcurrent)) {
        try {
          await this.startTask(t);
        } catch (e) {
          if (t.status === 'queued') this.setStatus(t, 'working');
          this.setStatus(t, 'needs_help', { resultSummary: `Could not start: ${msg(e)}` });
          await this.saveTasks();
          this.emitEvent({ type: 'error', message: `${t.id}: ${msg(e)}` });
        }
      }
    });
  }

  pauseTask(taskId: string): Promise<void> {
    return this.run(async () => {
      const t = this.mustTask(taskId);
      if (t.status !== 'working') throw new Error(`Task ${taskId} is not running`);
      t.held = true;
      this.setStatus(t, 'queued');
      const agent = this.mustAgent(t.assigneeId);
      agent.status = 'paused';
      agent.bubble = 'Paused';
      await this.saveTasks();
      await this.saveAgents();
      this.live.get(agent.id)?.runner.stop();
    });
  }

  async resumeTask(taskId: string): Promise<void> {
    await this.run(async () => {
      const t = this.mustTask(taskId);
      t.held = false;
      t.updatedAt = this.now();
      await this.saveTasks();
      this.emitEvent({ type: 'tasks-changed' });
    });
    await this.pump();
  }

  cancelTask(taskId: string): Promise<void> {
    return this.run(async () => {
      const t = this.mustTask(taskId);
      const wasWorking = t.status === 'working';
      this.setStatus(t, 'cancelled');
      await this.saveTasks();
      if (wasWorking) this.live.get(t.assigneeId)?.runner.stop();
    });
  }

  async markDone(taskId: string): Promise<void> {
    await this.run(async () => {
      this.setStatus(this.mustTask(taskId), 'done');
      await this.saveTasks();
    });
    await this.pump();
  }

  // ---------- internals ----------

  private async startTask(task: Task): Promise<void> {
    const agent = this.mustAgent(task.assigneeId);
    const role = await this.d.roles.get(agent.roleId);
    if (!role) throw new Error(`Role ${agent.roleId} is missing`);
    const wt = await this.d.worktrees.prepare(agent.name, task.branch, this.d.project.baseBranch);
    agent.worktreePath = wt;
    agent.status = 'thinking';
    agent.bubble = 'Starting…';

    const boss = this.agentList.find((a) => a.kind === 'boss');
    const skills = await this.d.skills.getMany(role.skills);
    const promptFile = path.join(this.d.promptDir, `${agent.id}.md`);
    await fs.mkdir(this.d.promptDir, { recursive: true });
    await fs.writeFile(promptFile, renderPrompt(role, skills, {
      agentName: agent.name, bossName: boss?.name ?? 'the boss', branch: task.branch, projectName: this.d.project.name, kind: 'employee',
    }));

    const runner = this.d.createRunner({
      bin: this.d.claudeBin,
      cwd: wt,
      launch: {
        model: role.model,
        permissionMode: role.permissionMode,
        allowedTools: role.allowedTools,
        appendSystemPromptFile: promptFile,
        resume: agent.sessionId,
        sessionId: agent.sessionId ? undefined : randomUUID(),
        isolateUserSettings: this.d.isolateUserSettings,
      },
    });
    this.live.set(agent.id, { runner, taskId: task.id });
    // Errors are already reported as { type: 'error' } by run(); swallow here to avoid unhandled rejections.
    runner.on('event', (ev) => { this.run(() => this.onRunnerEvent(agent.id, task.id, runner, ev)).catch(() => undefined); });

    const message = taskMessage(task);
    this.setStatus(task, 'working', { attempts: task.attempts + 1 });
    await this.saveTasks();
    runner.start();
    if (runner.running) runner.send(message);
  }

  private async onRunnerEvent(agentId: string, taskId: string, runner: AgentRunner, ev: RunnerEvent): Promise<void> {
    const agent = this.mustAgent(agentId);
    const task = this.taskList.find((t) => t.id === taskId);
    // Logging is best-effort: a full disk must never stall the task state machine.
    await this.d.store.appendLog(this.d.project.id, agentId, { at: this.now(), taskId, event: ev }).catch(() => undefined);

    if (ev.type === 'init' && ev.sessionId && agent.sessionId !== ev.sessionId) {
      agent.sessionId = ev.sessionId;
      await this.saveAgents().catch(() => undefined);
    }
    if (agent.status !== 'paused') Object.assign(agent, reduceStatus(agent, ev));
    if (ev.type === 'exit' && task?.status === 'cancelled') { agent.status = 'idle'; agent.bubble = 'Idle'; }
    this.emitEvent({ type: 'agent-event', agentId, event: ev });
    this.emitEvent({ type: 'agents-changed' });

    if (ev.type === 'result') {
      runner.endInput();
      if (task?.status === 'working') await this.finishTask(agent, task, ev.ok, ev.text);
    }

    if (ev.type === 'exit') {
      if (this.live.get(agentId)?.runner === runner) this.live.delete(agentId);
      try {
        if (task?.status === 'working') {
          const tail = runner.lastStderr;
          await this.finishTask(agent, task, false, `The session exited (code ${ev.code ?? ev.signal}) before finishing.${tail ? `\n${tail}` : ''}`);
        }
        await this.saveAgents();
      } finally {
        // Start whatever was waiting on this agent or on a free slot (queued after this handler).
        this.pump().catch(() => undefined);
      }
    }
  }

  private async finishTask(agent: Agent, task: Task, ok: boolean, text: string): Promise<void> {
    this.setStatus(task, ok ? 'review' : 'needs_help', { resultSummary: text.trim() });
    try {
      if (agent.worktreePath) await this.d.worktrees.commitAll(agent.worktreePath, `${task.id}: ${task.title}\n\nCommitted by AgentOffice for ${agent.name}.`);
      task.diffStat = await this.d.worktrees.diffStat(this.d.project.baseBranch, task.branch);
    } catch (e) {
      task.resultSummary = `${task.resultSummary}\n(Could not read the changes: ${msg(e)})`;
    }
    await this.saveTasks();
    this.emitEvent({ type: 'task-finished', task: { ...task }, agent: { ...agent } });
  }

  private setStatus(task: Task, to: TaskStatus, patch: Partial<Task> = {}): void {
    assertTransition(task, to);
    Object.assign(task, patch, { status: to, updatedAt: this.now() });
    this.emitEvent({ type: 'tasks-changed' });
  }

  private run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.chain.then(fn);
    this.chain = result.then(() => undefined, (e) => { this.emitEvent({ type: 'error', message: msg(e) }); });
    return result;
  }

  private mustAgent(id: string): Agent {
    const a = this.agentList.find((x) => x.id === id);
    if (!a) throw new Error(`Unknown agent ${id}`);
    return a;
  }

  private mustTask(id: string): Task {
    const t = this.taskList.find((x) => x.id === id);
    if (!t) throw new Error(`Unknown task ${id}`);
    return t;
  }

  private async saveAgents(): Promise<void> {
    await this.d.store.saveAgents(this.d.project.id, this.agentList);
    this.emitEvent({ type: 'agents-changed' });
  }

  private saveTasks(): Promise<void> {
    return this.d.store.saveTasks(this.d.project.id, this.taskList);
  }

  private emitEvent(e: ManagerEvent): void {
    this.emit('event', e);
  }

  private now(): string {
    return (this.d.now?.() ?? new Date()).toISOString();
  }
}
