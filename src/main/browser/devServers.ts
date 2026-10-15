import http from 'node:http';
import spawn from 'cross-spawn';
import type { ChildProcess } from 'node:child_process';
import { killTree } from '../claude/killTree';
import { freePort, splitCommand, stripAnsi } from './rules';

export interface DevServerInfo { url: string; port: number; command: string; running: boolean }

interface Running { child: ChildProcess; info: DevServerInfo; lines: string[]; exited: Promise<void> }

const KEEP = 200;

/** One dev server per employee, started in that employee's worktree; stopped with its task, its employee or the project. */
export class DevServerService {
  private servers = new Map<string, Running>();
  /** Set by close(): starts in flight give up and new ones are refused. */
  private closed = false;

  constructor(private readonly opts: { cwdFor(agentId: string): string | undefined; waitMs?: number; onChange?(): void }) {}

  async start(agentId: string, command: string): Promise<{ url: string; port: number }> {
    if (this.closed) throw new Error('The project is closed');
    const cwd = this.opts.cwdFor(agentId);
    if (!cwd) throw new Error('You have no working folder yet; start a task first.');
    const port = await freePort();
    const [bin, ...args] = splitCommand(command, port);
    await this.stop(agentId);
    if (this.closed) throw new Error('The project is closed');
    const child = spawn(bin, args, {
      cwd, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', BROWSER: 'none', CI: '1' },
    });
    const url = `http://127.0.0.1:${port}/`;
    const run: Running = { child, info: { url, port, command, running: true }, lines: [], exited: Promise.resolve() };
    run.exited = new Promise((resolve) => {
      child.once('exit', () => { run.info.running = false; resolve(); this.opts.onChange?.(); });
      child.once('error', (e) => { run.lines.push(`Could not start: ${e.message}`); run.info.running = false; resolve(); });
    });
    const add = (chunk: Buffer) => {
      for (const l of stripAnsi(chunk.toString('utf8')).split(/\r?\n/)) if (l.trim()) run.lines.push(l);
      if (run.lines.length > KEEP) run.lines.splice(0, run.lines.length - KEEP);
    };
    child.stdout?.on('data', add);
    child.stderr?.on('data', add);
    this.servers.set(agentId, run);
    this.opts.onChange?.();

    const deadline = Date.now() + (this.opts.waitMs ?? 90_000);
    while (Date.now() < deadline) {
      if (this.closed) {
        await this.stop(agentId);
        throw new Error('The project is closed');
      }
      if (!run.info.running) {
        this.servers.delete(agentId);
        // A launcher (npm, a script) can exit while the server it started keeps the port: kill its whole group.
        if (child.pid) killTree(child.pid);
        throw new Error(`The dev server exited before it was ready. Last output:\n${run.lines.slice(-40).join('\n')}`);
      }
      if (await answers(port)) return { url, port };
      await new Promise((r) => setTimeout(r, 500));
    }
    await this.stop(agentId);
    throw new Error(`Nothing answered on port ${port} after ${Math.round((this.opts.waitMs ?? 90_000) / 1000)} s. The server may be ignoring the PORT variable: pass the port yourself with {port}, e.g. "npm run dev -- --port {port}". Last output:\n${run.lines.slice(-40).join('\n')}`);
  }

  /** Every employee's dev server, running or not. */
  all(): { agentId: string; info: DevServerInfo }[] {
    return [...this.servers].map(([agentId, r]) => ({ agentId, info: { ...r.info } }));
  }

  info(agentId: string): DevServerInfo | null {
    const r = this.servers.get(agentId);
    return r ? { ...r.info } : null;
  }

  logs(agentId: string, lines = 60): string {
    const r = this.servers.get(agentId);
    if (!r) return 'No dev server is running.';
    return r.lines.slice(-Math.min(Math.max(1, lines), KEEP)).join('\n');
  }

  async stop(agentId: string): Promise<boolean> {
    const r = this.servers.get(agentId);
    if (!r) return false;
    this.servers.delete(agentId);
    if (!r.info.running && r.child.pid) killTree(r.child.pid); // the launcher is gone; its group may not be
    if (r.info.running && r.child.pid) {
      killTree(r.child.pid);
      // Escalate if it ignores SIGTERM, then wait for the exit so ports and folders are free.
      const timer = setTimeout(() => { if (r.child.pid) killTree(r.child.pid, process.platform, 'SIGKILL'); }, 3000);
      // Never hang a project close on a process that will not report its exit.
      await Promise.race([r.exited, new Promise((res) => setTimeout(res, 10_000))]);
      clearTimeout(timer);
    }
    this.opts.onChange?.();
    return true;
  }

  /** Project closing: stop everything and refuse new servers. */
  async close(): Promise<void> {
    this.closed = true;
    await this.stopAll();
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.servers.keys()].map((id) => this.stop(id)));
  }
}

function answers(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 1000 }, (res) => { res.resume(); resolve(true); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}
