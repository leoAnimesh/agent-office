import { EventEmitter } from 'node:events';
import type { TerminalEvent } from '../../shared/types';

/** The part of a node-pty terminal the service uses (so tests can pass a fake). */
export interface PtyLike {
  readonly pid: number;
  onData(cb: (data: string) => void): unknown;
  onExit(cb: (e: { exitCode: number }) => void): unknown;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export type SpawnPty = (file: string, args: string[], opts: { name: string; cwd: string; cols: number; rows: number; env: NodeJS.ProcessEnv }) => PtyLike;

export type { TerminalEvent };

export interface TerminalDeps {
  spawn: SpawnPty;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** Output is sent at most once per this many ms (one IPC message per frame, not per chunk). */
  batchMs?: number;
  /** How much recent output is kept to redraw the panel when it is reopened. */
  backlogBytes?: number;
  /** Windows: kill the shell's whole process tree so nothing keeps the project folder locked. */
  killTree?: (pid: number, signal?: NodeJS.Signals) => void;
}

interface Session { pty: PtyLike; backlog: string; pending: string; timer: NodeJS.Timeout | null; exited: Promise<void> }

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number.isFinite(n) ? n : lo)));

/** The shells to try, in order: the user's login shell on macOS/Linux, PowerShell then cmd on Windows. */
export function shellsFor(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): { file: string; args: string[] }[] {
  if (platform === 'win32') return [{ file: 'powershell.exe', args: ['-NoLogo'] }, { file: env.ComSpec || 'cmd.exe', args: [] }];
  return [{ file: env.SHELL || '/bin/bash', args: ['-l'] }, { file: '/bin/sh', args: ['-l'] }];
}

/** One interactive shell per open project, run in the main process and drawn by xterm.js in the renderer. */
export class TerminalService extends EventEmitter {
  private sessions = new Map<string, Session>();

  constructor(private readonly d: TerminalDeps) {
    super();
  }

  get size(): number { return this.sessions.size; }

  /** Starts the project's shell if it is not running; returns recent output so the panel can redraw. */
  open(projectId: string, cwd: string, cols: number, rows: number): { backlog: string } {
    const s = this.sessions.get(projectId);
    if (s) {
      // The backlog already holds any output not sent yet; drop that batch so the panel doesn't draw it twice.
      if (s.timer) { clearTimeout(s.timer); s.timer = null; }
      s.pending = '';
      return { backlog: s.backlog };
    }
    this.start(projectId, cwd, cols, rows);
    return { backlog: '' };
  }

  restart(projectId: string, cwd: string, cols: number, rows: number): { backlog: string } {
    const old = this.sessions.get(projectId);
    if (old) { this.sessions.delete(projectId); this.stop(old); }
    this.start(projectId, cwd, cols, rows);
    return { backlog: '' };
  }

  write(projectId: string, data: string): void {
    this.sessions.get(projectId)?.pty.write(data);
  }

  resize(projectId: string, cols: number, rows: number): void {
    this.sessions.get(projectId)?.pty.resize(clamp(cols, 2, 500), clamp(rows, 1, 300));
  }

  /** Ends the shell; its exit is reported (the panel then offers Restart). */
  async kill(projectId: string): Promise<void> {
    const s = this.sessions.get(projectId);
    if (!s) return;
    await this.stop(s);
    // Still here: it never exited, even after SIGKILL. Forget it and say so.
    if (this.sessions.get(projectId) === s) {
      this.sessions.delete(projectId);
      this.emit('event', { type: 'exit', projectId, exitCode: -1 } satisfies TerminalEvent);
    }
  }

  async killAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.kill(id)));
  }

  private start(projectId: string, cwd: string, cols: number, rows: number): void {
    const platform = this.d.platform ?? process.platform;
    const base = this.d.env ?? process.env;
    const env = { ...base, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
    const opts = { name: 'xterm-256color', cwd, cols: clamp(cols, 2, 500), rows: clamp(rows, 1, 300), env };
    let pty: PtyLike | null = null;
    let lastError: unknown;
    for (const shell of shellsFor(platform, base)) {
      try { pty = this.d.spawn(shell.file, shell.args, opts); break; } catch (e) { lastError = e; }
    }
    if (!pty) throw new Error(`Could not start a shell: ${lastError instanceof Error ? lastError.message : String(lastError)}`);

    let exited!: () => void;
    const s: Session = { pty, backlog: '', pending: '', timer: null, exited: new Promise<void>((r) => { exited = r; }) };
    const cap = this.d.backlogBytes ?? 256 * 1024;
    pty.onData((data) => {
      s.backlog = (s.backlog + data).slice(-cap);
      s.pending += data;
      s.timer ??= setTimeout(() => this.flush(projectId, s), this.d.batchMs ?? 16);
    });
    pty.onExit(({ exitCode }) => {
      this.flush(projectId, s);
      // A restarted project already has a new session; only forget this one if it is still current.
      if (this.sessions.get(projectId) === s) {
        this.sessions.delete(projectId);
        this.emit('event', { type: 'exit', projectId, exitCode } satisfies TerminalEvent);
      }
      exited();
    });
    this.sessions.set(projectId, s);
  }

  private flush(projectId: string, s: Session): void {
    if (s.timer) { clearTimeout(s.timer); s.timer = null; }
    // A replaced (restarted) shell's last words must not land in the new one.
    if (!s.pending || this.sessions.get(projectId) !== s) { s.pending = ''; return; }
    const data = s.pending;
    s.pending = '';
    this.emit('event', { type: 'data', projectId, data } satisfies TerminalEvent);
  }

  /** Ends a shell and waits (briefly) for it to go, so Windows releases the project folder. */
  private async stop(s: Session): Promise<void> {
    const platform = this.d.platform ?? process.platform;
    const within = (ms: number) => Promise.race([s.exited.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), ms).unref?.())]);
    // Windows: take the tree down while the shell still links it (dev servers started from the shell included).
    if (platform === 'win32') { try { this.d.killTree?.(s.pty.pid); } catch { /* already gone */ } }
    try { s.pty.kill(); } catch { /* already gone */ }
    if (await within(2000)) return;
    // macOS/Linux: something ignored the hang-up; the shell leads its own process group, so SIGKILL the group.
    if (platform !== 'win32') { try { this.d.killTree?.(s.pty.pid, 'SIGKILL'); } catch { /* already gone */ } }
    await within(1000);
  }
}
