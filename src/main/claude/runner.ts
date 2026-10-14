import { EventEmitter } from 'node:events';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import crossSpawn from 'cross-spawn';
import type { RunnerEvent } from '../../shared/types';
import { buildClaudeArgs, userMessageLine, type ClaudeLaunch } from './args';
import { killTree } from './killTree';
import { LineSplitter, parseLine } from './streamParser';

export interface AgentRunner {
  readonly running: boolean;
  readonly lastStderr: string;
  start(): void;
  send(text: string): void;
  endInput(): void;
  stop(): void;
  on(event: 'event', listener: (ev: RunnerEvent) => void): this;
  off(event: 'event', listener: (ev: RunnerEvent) => void): this;
}

export interface ClaudeRunnerOptions {
  bin: string;
  /** Extra args placed before the claude flags (used to run a .mjs through node in tests). */
  binArgs?: string[];
  cwd: string;
  launch: ClaudeLaunch;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** How long stop() waits after SIGTERM before SIGKILL. */
  killGraceMs?: number;
}

export class ClaudeRunner extends EventEmitter implements AgentRunner {
  private child: ChildProcessWithoutNullStreams | null = null;
  private stderrTail: string[] = [];

  constructor(private readonly opts: ClaudeRunnerOptions) {
    super();
  }

  get running(): boolean { return this.child !== null; }
  get lastStderr(): string { return this.stderrTail.join('\n'); }

  start(): void {
    if (this.child) throw new Error('runner already started');
    const platform = this.opts.platform ?? process.platform;
    const args = [...(this.opts.binArgs ?? []), ...buildClaudeArgs(this.opts.launch)];
    const child = crossSpawn(this.opts.bin, args, {
      cwd: this.opts.cwd,
      env: this.opts.env ?? process.env,
      stdio: 'pipe',
      detached: platform !== 'win32',
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams;
    this.child = child;

    const out = new LineSplitter();
    const err = new LineSplitter();
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (c: string) => { for (const l of out.push(c)) this.emitLine(l); });
    child.stderr.on('data', (c: string) => { for (const l of err.push(c)) this.pushStderr(l); });
    child.stdin.on('error', () => { /* EPIPE after the process died; exit is reported separately */ });
    child.on('error', (e) => { this.pushStderr(e.message); this.finish(null, null, child); });
    child.on('close', (code, signal) => {
      for (const l of out.flush()) this.emitLine(l);
      for (const l of err.flush()) this.pushStderr(l);
      this.finish(code, signal, child);
    });
  }

  send(text: string): void {
    if (!this.child || !this.child.stdin.writable) throw new Error('runner is not running');
    this.child.stdin.write(userMessageLine(text));
  }

  endInput(): void {
    this.child?.stdin.end();
  }

  stop(): void {
    const child = this.child;
    const pid = child?.pid;
    if (!pid) return;
    const platform = this.opts.platform ?? process.platform;
    killTree(pid, platform);
    // A stuck tool can ignore SIGTERM; force it if the process is still ours after the grace period.
    setTimeout(() => { if (this.child === child) killTree(pid, platform, 'SIGKILL'); }, this.opts.killGraceMs ?? 5000).unref();
  }

  private emitLine(line: string): void {
    for (const ev of parseLine(line)) this.emit('event', ev);
  }

  private pushStderr(line: string): void {
    this.stderrTail.push(line);
    if (this.stderrTail.length > 20) this.stderrTail.shift();
    this.emit('event', { type: 'stderr', text: line } satisfies RunnerEvent);
  }

  private finish(code: number | null, signal: NodeJS.Signals | null, child: ChildProcessWithoutNullStreams): void {
    if (this.child !== child) return;
    this.child = null;
    this.emit('event', { type: 'exit', code, signal } satisfies RunnerEvent);
  }
}
