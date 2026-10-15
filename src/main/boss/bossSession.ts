import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { AUTO_MODEL, type ChatEntry, type DiffStat, type Project, type RunnerEvent, type Task } from '../../shared/types';
import type { AgentManager, ManagerEvent } from '../agents/agentManager';
import { renderPrompt } from '../agents/prompt';
import { waitForExit, type AgentRunner, type ClaudeRunnerOptions } from '../claude/runner';
import type { ProjectStore } from '../store/projectStore';
import type { RoleStore } from '../store/roleStore';
import type { SkillStore } from '../store/skillStore';

const MCP_PREFIX = 'mcp__agentoffice__';

export interface BossSessionDeps {
  project: Project;
  manager: AgentManager;
  roles: RoleStore;
  skills: SkillStore;
  store: ProjectStore;
  createRunner: (o: ClaudeRunnerOptions) => AgentRunner;
  claudeBin: string;
  promptDir: string;
  mcpConfigPath: string;
  isolateUserSettings: boolean;
  now?: () => Date;
}

export function describeFinished(task: Task, agentName: string): string {
  const files = task.diffStat && task.diffStat.length > 0 ? task.diffStat.map((f) => `${f.path} (+${f.add} −${f.del})`).join(', ') : 'none';
  const how = task.status === 'review' ? 'successfully' : 'with problems';
  return `${task.id} by ${agentName} finished ${how}. Summary: ${(task.resultSummary ?? '').trim()} Files: ${files}. Read it with get_task, then request_merge or message_agent.`;
}

/** The same news for the user: markdown with the summary as written, no tool instructions. The chat shows the files from the entry's `files`. */
export function finishedChatText(task: Task, agentName: string): string {
  const how = task.status === 'review' ? 'successfully' : 'with problems';
  const summary = (task.resultSummary ?? '').trim();
  const head = `**${task.id} by ${agentName} finished ${how}.**`;
  return summary ? `${head}\n\n${summary}` : head;
}
export class BossSession extends EventEmitter {
  private runner: AgentRunner | null = null;
  private textThisTurn = false;
  /** Reply text streamed so far for the current block (not saved until the full message arrives). */
  private streamText = '';
  /** Messages delivered to the boss that have not been answered yet. */
  private pending = 0;
  /** Whether the current runner was launched with --resume and has reported `init` yet. */
  private resumed = false;
  private sawInit = false;
  /** Last message delivered, replayed once if a stale session has to be replaced. */
  private lastText: string | null = null;
  private stopping = false;
  private detach: (() => void) | null = null;
  /** Delivery is serialized so two quick messages never start two boss processes. */
  private delivery: Promise<void> = Promise.resolve();
  private events: Promise<void> = Promise.resolve();

  constructor(private readonly d: BossSessionDeps) {
    super();
  }

  start(): void {
    const onEvent = (e: ManagerEvent) => {
      if (e.type === 'task-finished') this.notify(describeFinished(e.task, e.agent.name), e.task.id, finishedChatText(e.task, e.agent.name), e.task.diffStat ?? []).catch(() => undefined);
      if (e.type === 'agent-replied') this.notify(e.ok ? `${e.agent.name} replied: ${e.text}` : `${e.agent.name} could not answer: ${e.text}`).catch(() => undefined);
    };
    this.d.manager.on('event', onEvent);
    this.detach = () => { this.d.manager.off('event', onEvent); };
  }

  history(limit = 500): Promise<ChatEntry[]> {
    return this.d.store.readChat(this.d.project.id, limit);
  }

  async send(text: string): Promise<void> {
    await this.add({ kind: 'user', at: this.now(), text });
    await this.deliver(text);
  }

  /** `chatText` is what the user sees when it should differ from what the boss is told; `files` is shown as a file list. */
  async notify(text: string, taskId?: string, chatText?: string, files?: DiffStat[]): Promise<void> {
    await this.add({ kind: 'event', at: this.now(), text: chatText ?? text, ...(taskId ? { taskId } : {}), ...(files ? { files } : {}) });
    await this.deliver(`[AgentOffice] ${text}`);
  }

  async report(text: string): Promise<void> {
    await this.add({ kind: 'report', at: this.now(), text });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.detach?.();
    this.detach = null;
    await this.delivery;
    const runner = this.runner;
    if (runner) {
      const exited = waitForExit(runner);
      runner.stop();
      await exited;
    }
    await this.events;
  }

  private deliver(text: string): Promise<void> {
    const next = this.delivery.then(async () => {
      if (this.stopping) return;
      const runner = await this.ensureRunner();
      this.lastText = text;
      if (runner.running) {
        runner.send(text);
        this.setPending(this.pending + 1);
      }
    });
    this.delivery = next.catch(() => undefined);
    return next.catch(async (err: unknown) => {
      await this.add({ kind: 'error', at: this.now(), text: `Could not reach the boss: ${err instanceof Error ? err.message : String(err)}` });
    });
  }

  private async ensureRunner(): Promise<AgentRunner> {
    if (this.runner?.running) return this.runner;
    const boss = this.d.manager.agents().find((a) => a.kind === 'boss');
    if (!boss) throw new Error('This project has no boss yet');
    const role = await this.d.roles.get(boss.roleId);
    if (!role) throw new Error(`Role ${boss.roleId} is missing`);
    const skills = await this.d.skills.getMany(role.skills);
    const chosen = await this.d.skills.getMany((this.d.project.skills ?? []).map((s) => s.id));
    const promptFile = path.join(this.d.promptDir, `${boss.id}.md`);
    await fs.mkdir(this.d.promptDir, { recursive: true });
    await fs.writeFile(promptFile, renderPrompt(role, skills, {
      agentName: boss.name, bossName: boss.name, branch: this.d.project.baseBranch, projectName: this.d.project.name, kind: 'boss',
      projectSkills: { chosen: this.d.project.skills !== undefined, names: chosen.map((s) => s.name) },
    }));
    const runner = this.d.createRunner({
      bin: this.d.claudeBin,
      cwd: this.d.project.repoPath,
      launch: {
        // The boss is never classified; 'auto' would be an invalid --model.
        model: role.model === AUTO_MODEL ? 'opus' : role.model,
        permissionMode: role.permissionMode,
        tools: role.allowedTools,
        allowedTools: ['mcp__agentoffice'],
        appendSystemPromptFile: promptFile,
        mcpConfigPath: this.d.mcpConfigPath,
        resume: boss.sessionId,
        sessionId: boss.sessionId ? undefined : randomUUID(),
        isolateUserSettings: this.d.isolateUserSettings,
        includePartialMessages: true,
      },
    });
    runner.on('event', (ev) => {
      this.events = this.events.then(() => this.onEvent(boss.id, runner, ev)).catch(() => undefined);
    });
    this.runner = runner;
    this.resumed = Boolean(boss.sessionId);
    this.sawInit = false;
    this.textThisTurn = false;
    runner.start();
    return runner;
  }

  private async onEvent(bossId: string, runner: AgentRunner, ev: RunnerEvent): Promise<void> {
    // Fire-and-forget: chat must never wait behind long manager work such as a git merge.
    // Status updates are fire-and-forget; skip all but the first piece of a streamed reply.
    if (ev.type !== 'text_delta' || this.streamText === '') void this.d.manager.setLive(bossId, ev).catch(() => undefined);
    switch (ev.type) {
      case 'init':
        this.sawInit = true;
        this.textThisTurn = false;
        if (ev.sessionId) await this.d.manager.setSessionId(bossId, ev.sessionId).catch(() => undefined);
        break;
      case 'text_delta':
        this.streamText += ev.text;
        this.emit('stream', this.streamText);
        break;
      case 'text':
        this.textThisTurn = true;
        await this.add({ kind: 'boss', at: this.now(), text: ev.text });
        this.clearStream();
        break;
      case 'tool_use':
        if (ev.name.startsWith(MCP_PREFIX)) await this.add({ kind: 'tool', at: this.now(), tool: ev.name.slice(MCP_PREFIX.length), input: ev.input });
        break;
      case 'result':
        if (!ev.ok) await this.add({ kind: 'error', at: this.now(), text: `The boss hit a problem: ${ev.text}` });
        else if (!this.textThisTurn && ev.text.trim()) await this.add({ kind: 'boss', at: this.now(), text: ev.text });
        this.textThisTurn = false;
        this.clearStream();
        this.setPending(this.pending - 1);
        break;
      case 'exit':
        if (this.runner === runner) this.runner = null;
        this.clearStream();
        this.setPending(0);
        if (!this.stopping && ev.code !== 0 && this.resumed && !this.sawInit) {
          // The saved conversation is gone (expired or deleted). Start over instead of failing forever.
          await this.d.manager.setSessionId(bossId, null).catch(() => undefined);
          await this.add({ kind: 'error', at: this.now(), text: 'The earlier boss conversation could not be restored, so a fresh boss session was started. It may need a reminder of what you were working on.' });
          if (this.lastText) void this.deliver(this.lastText);
        } else if (!this.stopping && ev.code !== 0) {
          const tail = runner.lastStderr;
          await this.add({ kind: 'error', at: this.now(), text: `The boss session ${ev.code === null && ev.signal === null ? 'could not start' : `stopped (${ev.code ?? ev.signal})`}. It will restart with your next message.${tail ? `\n${tail}` : ''}` });
        }
        break;
      default:
        break;
    }
  }

  private clearStream(): void {
    if (this.streamText === '') return;
    this.streamText = '';
    this.emit('stream', null);
  }

  private setPending(n: number): void {
    const next = Math.max(0, n);
    const was = this.pending > 0;
    this.pending = next;
    if (was !== next > 0) this.emit('busy', next > 0);
  }

  private async add(entry: ChatEntry): Promise<void> {
    await this.d.store.appendChat(this.d.project.id, entry).catch(() => undefined);
    this.emit('chat', entry);
  }

  private now(): string {
    return (this.d.now?.() ?? new Date()).toISOString();
  }
}
