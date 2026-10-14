import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import type { Agent, Project, Role, RunnerEvent, Task, TaskStatus } from '../../shared/types';
import { waitForExit, type AgentRunner, type ClaudeRunnerOptions } from '../claude/runner';
import { reduceStatus } from '../claude/status';
import { WorktreeManager, git, slugify, type MergeResult } from '../git/worktrees';
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
  | { type: 'agent-replied'; agent: Agent; text: string; ok: boolean }
  | { type: 'error'; message: string };

export type MergeOutcome = MergeResult | { status: 'not_ready'; reason: string };

export interface NewTask { assignee: string; title: string; brief: string; dependsOn?: string[]; createdBy: 'boss' | 'user' }

interface Live {
  runner: AgentRunner;
  taskId: string | null;
  /** Launched with --resume; if it dies before `init`, the saved session is unusable. */
  resumed: boolean;
  sawInit: boolean;
}

export interface MessageResult { delivered: 'sent' | 'started'; taskId: string | null }

/** A mistake in the request (unknown name, duplicate, busy…), not an app failure; not broadcast as an app error. */
export class UserError extends Error {}

const NAME_POOL = ['Pixel', 'Byte', 'Quinn', 'Ivy', 'Nova', 'Rex', 'Juno', 'Sage', 'Kit', 'Ziggy', 'Milo', 'Tess'];
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class AgentManager extends EventEmitter {
  private agentList: Agent[] = [];
  private taskList: Task[] = [];
  private live = new Map<string, Live>();
  /** All mutations run one at a time through this chain. */
  private chain: Promise<void> = Promise.resolve();
  /** Set by shutdown(): no new sessions start and exits no longer change task state. */
  private closed = false;

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

  /** Loads saved state; tasks that were running when the app stopped go back to the queue. Returns their ids. */
  async load(): Promise<string[]> {
    this.agentList = await this.d.store.getAgents(this.d.project.id);
    this.taskList = await this.d.store.getTasks(this.d.project.id);
    for (const a of this.agentList) { a.status = 'idle'; a.bubble = 'Idle'; }
    const requeued: string[] = [];
    for (const t of this.taskList) {
      if (t.status === 'working') { t.status = 'queued'; t.updatedAt = this.now(); requeued.push(t.id); }
    }
    if (requeued.length > 0) await this.saveTasks();
    return requeued;
  }

  idle(): Promise<void> { return this.chain; }

  async shutdown(): Promise<void> {
    this.closed = true;
    // Wait for the processes to really exit: Windows keeps their working folders locked until then.
    const runners = [...this.live.values()].map((l) => l.runner);
    const exits = runners.map((r) => waitForExit(r));
    for (const r of runners) r.stop();
    await Promise.all(exits);
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
      if (!role) throw new UserError(`Unknown role: ${roleId}`);
      const taken = new Set(this.agentList.map((a) => a.name.toLowerCase()));
      const finalName = name?.trim() || NAME_POOL.find((n) => !taken.has(n.toLowerCase())) || `${role.name} ${this.agentList.length + 1}`;
      if (taken.has(finalName.toLowerCase())) throw new UserError(`An agent named ${finalName} already exists`);
      // Worktrees and branches are keyed by slug, so two employees must never share one.
      const clash = this.agentList.find((a) => a.kind === 'employee' && slugify(a.name) === slugify(finalName));
      if (clash) throw new UserError(`The name ${finalName} is too similar to ${clash.name}; pick a more distinct name`);
      const agent: Agent = { id: randomUUID(), projectId: this.d.project.id, name: finalName, roleId, kind: 'employee', status: 'idle', bubble: 'Idle' };
      this.agentList.push(agent);
      await this.saveAgents();
      return { ...agent };
    });
  }

  async createTask(input: NewTask): Promise<Task> {
    const task = await this.run(async () => {
      this.assertOpen();
      const agent = this.findAgent(input.assignee);
      if (!agent || agent.kind !== 'employee') throw new UserError(`No employee named ${input.assignee}`);
      for (const dep of input.dependsOn ?? []) {
        if (!this.taskList.some((t) => t.id === dep)) throw new UserError(`Unknown task ${dep}`);
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
      if (this.closed) return;
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
      if (t.status !== 'working') throw new UserError(`Task ${taskId} is not running`);
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

  fire(agentId: string): Promise<void> {
    return this.run(async () => {
      this.assertOpen();
      const agent = this.mustAgent(agentId);
      if (agent.kind === 'boss') throw new UserError('The boss cannot be fired');
      const open = this.taskList.filter((t) => t.assigneeId === agent.id && ['queued', 'working', 'needs_help', 'review'].includes(t.status));
      if (open.length > 0) throw new UserError(`${agent.name} still has open work: ${open.map((t) => t.id).join(', ')}. Merge or cancel it first.`);
      if (this.live.has(agent.id)) throw new UserError(`${agent.name} is working right now. Wait for them to finish first.`);
      if (agent.worktreePath && existsSync(agent.worktreePath)) {
        // Keep anything not yet committed (e.g. a reply that edited files) on the agent's branch.
        await this.d.worktrees.commitAll(agent.worktreePath, `WIP: saved by AgentOffice before ${agent.name} left the team`).catch(() => undefined);
      }
      await this.d.worktrees.remove(agent.name);
      this.agentList = this.agentList.filter((a) => a.id !== agent.id);
      await this.saveAgents();
    });
  }

  getTask(id: string): Task | undefined {
    const t = this.taskList.find((x) => x.id === id);
    return t ? { ...t } : undefined;
  }

  /**
   * Feedback for an employee. If they have a task in review or needing help, it is reopened and the
   * follow-up runs as part of that task (so it is committed, diffed and reported). Otherwise the
   * message is a plain question and the answer comes back as 'agent-replied'.
   */
  messageAgent(ref: string, text: string): Promise<MessageResult> {
    return this.run(async (): Promise<MessageResult> => {
      this.assertOpen();
      const agent = this.findAgent(ref);
      if (!agent || agent.kind !== 'employee') throw new UserError(`No employee named ${ref}`);
      const live = this.live.get(agent.id);
      if (live?.runner.running) {
        try {
          live.runner.send(text);
        } catch {
          throw new UserError(`${agent.name} is just finishing up. Try again in a moment.`);
        }
        return { delivered: 'sent', taskId: live.taskId };
      }
      const role = await this.d.roles.get(agent.roleId);
      if (!role) throw new Error(`Role ${agent.roleId} is missing`);

      const open = this.taskList
        .filter((t) => t.assigneeId === agent.id && (t.status === 'review' || t.status === 'needs_help'))
        .sort((x, y) => y.updatedAt.localeCompare(x.updatedAt))[0];
      if (open) {
        const wt = await this.d.worktrees.prepare(agent.name, open.branch, this.d.project.baseBranch);
        agent.worktreePath = wt;
        const fresh = !agent.sessionId;
        const runner = this.spawn(agent, role, wt, await this.writePrompt(agent, role, open.branch), open.id);
        this.setStatus(open, 'queued');
        this.setStatus(open, 'working', { attempts: open.attempts + 1 });
        await this.saveTasks();
        agent.status = 'thinking';
        agent.bubble = 'Reading feedback…';
        runner.start();
        if (runner.running) runner.send(this.feedbackMessage(open, text, fresh));
        return { delivered: 'started', taskId: open.id };
      }

      if (!agent.sessionId || !agent.worktreePath) throw new UserError(`${agent.name} has not worked on anything yet. Assign a task instead.`);
      const branch = await git(agent.worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD']);
      const runner = this.spawn(agent, role, agent.worktreePath, await this.writePrompt(agent, role, branch), null);
      agent.status = 'thinking';
      agent.bubble = 'Reading a message…';
      runner.start();
      if (runner.running) runner.send(text);
      return { delivered: 'started', taskId: null };
    });
  }

  async merge(taskId: string): Promise<MergeOutcome> {
    const outcome = await this.run(async (): Promise<MergeOutcome> => {
      const t = this.mustTask(taskId);
      if (t.status !== 'review') return { status: 'not_ready', reason: `Task ${taskId} is ${t.status}, not waiting for review.` };
      const r = await this.d.worktrees.merge(this.d.project.baseBranch, t.branch, `Merge ${t.id}: ${t.title}`);
      if (r.status === 'merged') {
        this.setStatus(t, 'done');
        await this.saveTasks();
      }
      return r;
    });
    if (outcome.status === 'merged') await this.pump();
    return outcome;
  }

  /** Pass null to forget a session that can no longer be resumed. */
  setSessionId(agentId: string, sessionId: string | null): Promise<void> {
    return this.run(async () => {
      const a = this.mustAgent(agentId);
      const next = sessionId ?? undefined;
      if (a.sessionId === next) return;
      a.sessionId = next;
      await this.saveAgents();
    });
  }

  /** Live status for agents whose runner lives outside the manager (the boss). */
  setLive(agentId: string, ev: RunnerEvent): Promise<void> {
    return this.run(async () => {
      const a = this.mustAgent(agentId);
      Object.assign(a, reduceStatus(a, ev));
      this.emitEvent({ type: 'agents-changed' });
    });
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

    const promptFile = await this.writePrompt(agent, role, task.branch);
    const runner = this.spawn(agent, role, wt, promptFile, task.id);
    const message = taskMessage(task);
    this.setStatus(task, 'working', { attempts: task.attempts + 1 });
    await this.saveTasks();
    runner.start();
    if (runner.running) runner.send(message);
  }

  private feedbackMessage(task: Task, text: string, freshSession: boolean): string {
    const boss = this.agentList.find((a) => a.kind === 'boss')?.name ?? 'the boss';
    const brief = freshSession ? `\n\nThe original brief:\n\n${task.brief.trim()}` : '';
    return `Feedback on task ${task.id} ("${task.title}") from ${boss}: ${text.trim()}\n\nMake the changes on your current branch, commit them, and reply with a short summary (at most 5 lines).${brief}`;
  }

  private assertOpen(): void {
    if (this.closed) throw new UserError('This project is closed');
  }

  private async writePrompt(agent: Agent, role: Role, branch: string): Promise<string> {
    const boss = this.agentList.find((a) => a.kind === 'boss');
    const skills = await this.d.skills.getMany(role.skills);
    const promptFile = path.join(this.d.promptDir, `${agent.id}.md`);
    await fs.mkdir(this.d.promptDir, { recursive: true });
    await fs.writeFile(promptFile, renderPrompt(role, skills, {
      agentName: agent.name, bossName: boss?.name ?? 'the boss', branch, projectName: this.d.project.name, kind: 'employee',
    }));
    return promptFile;
  }

  private spawn(agent: Agent, role: Role, cwd: string, promptFile: string, taskId: string | null): AgentRunner {
    const runner = this.d.createRunner({
      bin: this.d.claudeBin,
      cwd,
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
    this.live.set(agent.id, { runner, taskId, resumed: Boolean(agent.sessionId), sawInit: false });
    // Errors are already reported as { type: 'error' } by run(); swallow here to avoid unhandled rejections.
    runner.on('event', (ev) => { this.run(() => this.onRunnerEvent(agent.id, taskId, runner, ev)).catch(() => undefined); });
    return runner;
  }

  private async onRunnerEvent(agentId: string, taskId: string | null, runner: AgentRunner, ev: RunnerEvent): Promise<void> {
    const agent = this.mustAgent(agentId);
    const task = taskId ? this.taskList.find((t) => t.id === taskId) : undefined;
    // Logging is best-effort: a full disk must never stall the task state machine.
    await this.d.store.appendLog(this.d.project.id, agentId, { at: this.now(), taskId, event: ev }).catch(() => undefined);

    const entry = this.live.get(agentId);
    const mine = entry?.runner === runner ? entry : undefined;
    if (ev.type === 'init' && mine) mine.sawInit = true;
    if (ev.type === 'init' && ev.sessionId && agent.sessionId !== ev.sessionId) {
      agent.sessionId = ev.sessionId;
      await this.saveAgents().catch(() => undefined);
    }
    if (agent.status !== 'paused') Object.assign(agent, reduceStatus(agent, ev));
    if (ev.type === 'exit' && task?.status === 'cancelled') { agent.status = 'idle'; agent.bubble = 'Idle'; }
    this.emitEvent({ type: 'agent-event', agentId, event: ev });
    this.emitEvent({ type: 'agents-changed' });

    if (this.closed) {
      // Shutting down: leave tasks as they are so the next load() re-queues them.
      if (ev.type === 'exit' && mine) this.live.delete(agentId);
      return;
    }

    if (ev.type === 'result') {
      runner.endInput();
      if (task?.status === 'working') await this.finishTask(agent, task, ev.ok, ev.text);
      else if (taskId === null) this.emitEvent({ type: 'agent-replied', agent: { ...agent }, text: ev.text, ok: ev.ok });
    }

    if (ev.type === 'exit') {
      if (mine) this.live.delete(agentId);
      try {
        if (mine?.resumed && !mine.sawInit && ev.code !== 0) {
          // The saved session could not be resumed (expired or deleted): forget it and start fresh.
          agent.sessionId = undefined;
          if (task?.status === 'working') {
            this.setStatus(task, 'queued');
            await this.saveTasks();
          }
        } else if (task?.status === 'working') {
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
    // Runs inside the serialized chain, so nothing else can finish this task meanwhile. Collect the
    // changes first so the task never shows up as finished without its diff.
    let summary = text.trim();
    let diffStat = task.diffStat;
    try {
      if (agent.worktreePath) await this.d.worktrees.commitAll(agent.worktreePath, `${task.id}: ${task.title}\n\nCommitted by AgentOffice for ${agent.name}.`);
      diffStat = await this.d.worktrees.diffStat(this.d.project.baseBranch, task.branch);
    } catch (e) {
      summary = `${summary}\n(Could not read the changes: ${msg(e)})`;
    }
    this.setStatus(task, ok ? 'review' : 'needs_help', { resultSummary: summary, diffStat });
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
    this.chain = result.then(() => undefined, (e) => { if (!(e instanceof UserError)) this.emitEvent({ type: 'error', message: msg(e) }); });
    return result;
  }

  private mustAgent(id: string): Agent {
    const a = this.agentList.find((x) => x.id === id);
    if (!a) throw new UserError(`Unknown agent ${id}`);
    return a;
  }

  private mustTask(id: string): Task {
    const t = this.taskList.find((x) => x.id === id);
    if (!t) throw new UserError(`Unknown task ${id}`);
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
