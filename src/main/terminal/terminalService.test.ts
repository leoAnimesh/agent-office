import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalService, shellsFor, type PtyLike, type SpawnPty, type TerminalEvent } from './terminalService';

class FakePty implements PtyLike {
  static last: FakePty;
  pid = 4242;
  written: string[] = [];
  size: [number, number];
  killed = false;
  private dataCbs: ((d: string) => void)[] = [];
  private exitCbs: ((e: { exitCode: number }) => void)[] = [];
  constructor(public file: string, public args: string[], public opts: Parameters<SpawnPty>[2]) { this.size = [opts.cols, opts.rows]; FakePty.last = this; }
  onData(cb: (d: string) => void) { this.dataCbs.push(cb); return { dispose: () => undefined }; }
  onExit(cb: (e: { exitCode: number }) => void) { this.exitCbs.push(cb); return { dispose: () => undefined }; }
  write(d: string) { this.written.push(d); }
  resize(c: number, r: number) { this.size = [c, r]; }
  kill() { this.killed = true; this.exit(0); }
  emit(d: string) { for (const cb of this.dataCbs) cb(d); }
  exit(code: number) { for (const cb of this.exitCbs) cb({ exitCode: code }); }
}

let spawned: FakePty[];
let events: TerminalEvent[];
const spawn: SpawnPty = (file, args, opts) => { const p = new FakePty(file, args, opts); spawned.push(p); return p; };
const make = (over: Partial<ConstructorParameters<typeof TerminalService>[0]> = {}) => {
  const svc = new TerminalService({ spawn, platform: 'darwin', env: { SHELL: '/bin/zsh', PATH: '/usr/bin' }, batchMs: 16, ...over });
  svc.on('event', (e: TerminalEvent) => events.push(e));
  return svc;
};

beforeEach(() => { spawned = []; events = []; vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('TerminalService', () => {
  it('starts the login shell in the project folder with a colour terminal', () => {
    make().open('p1', '/repo', 100, 30);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]).toMatchObject({ file: '/bin/zsh', args: ['-l'] });
    expect(spawned[0].opts).toMatchObject({ cwd: '/repo', cols: 100, rows: 30, name: 'xterm-256color' });
    expect(spawned[0].opts.env).toMatchObject({ TERM: 'xterm-256color', COLORTERM: 'truecolor', PATH: '/usr/bin' });
  });

  it('keeps one session per project and replays its recent output on reopen', () => {
    const svc = make();
    svc.open('p1', '/repo', 80, 24);
    spawned[0].emit('hello ');
    spawned[0].emit('world');
    expect(svc.open('p1', '/repo', 80, 24)).toEqual({ backlog: 'hello world' });
    expect(spawned).toHaveLength(1);
    svc.open('p2', '/other', 80, 24);
    expect(spawned).toHaveLength(2);
  });

  it('batches output into one event per frame', () => {
    make().open('p1', '/repo', 80, 24);
    spawned[0].emit('a');
    spawned[0].emit('b');
    expect(events).toEqual([]);
    vi.advanceTimersByTime(16);
    expect(events).toEqual([{ type: 'data', projectId: 'p1', data: 'ab' }]);
  });

  it('keeps only the most recent output as backlog', () => {
    const svc = make({ backlogBytes: 10 });
    svc.open('p1', '/repo', 80, 24);
    spawned[0].emit('0123456789abcdef');
    expect(svc.open('p1', '/repo', 80, 24).backlog).toBe('6789abcdef');
  });

  it('writes input and clamps resizes', () => {
    const svc = make();
    svc.open('p1', '/repo', 80, 24);
    svc.write('p1', 'ls\r');
    svc.resize('p1', 9999, 0);
    expect(spawned[0].written).toEqual(['ls\r']);
    expect(spawned[0].size).toEqual([500, 1]);
    expect(() => svc.write('nope', 'x')).not.toThrow();
  });

  it('reports an exit and forgets the session, so the next open starts fresh', () => {
    const svc = make();
    svc.open('p1', '/repo', 80, 24);
    spawned[0].exit(3);
    expect(events).toContainEqual({ type: 'exit', projectId: 'p1', exitCode: 3 });
    expect(svc.open('p1', '/repo', 80, 24)).toEqual({ backlog: '' });
    expect(spawned).toHaveLength(2);
  });

  it('restart kills the old shell and starts a new one', () => {
    const svc = make();
    svc.open('p1', '/repo', 80, 24);
    expect(svc.restart('p1', '/repo', 80, 24)).toEqual({ backlog: '' });
    expect(spawned[0].killed).toBe(true);
    expect(spawned).toHaveLength(2);
  });

  it('kills every session, and the whole tree on Windows', async () => {
    const killTree = vi.fn();
    const svc = make({ platform: 'win32', env: {}, killTree });
    svc.open('p1', 'C:\\repo', 80, 24);
    svc.open('p2', 'C:\\other', 80, 24);
    await svc.killAll();
    expect(spawned.every((p) => p.killed)).toBe(true);
    expect(killTree).toHaveBeenCalledTimes(2);
  });

  it('falls back to the next shell when the first one fails to start', () => {
    let calls = 0;
    const flaky: SpawnPty = (file, args, opts) => { calls++; if (calls === 1) throw new Error('no such shell'); return spawn(file, args, opts); };
    make({ spawn: flaky, env: { SHELL: '/nope/zsh' } }).open('p1', '/repo', 80, 24);
    expect(spawned[0]).toMatchObject({ file: '/bin/sh' });
  });
});

describe('shellsFor', () => {
  it('uses the login shell on macOS and Linux, PowerShell then cmd on Windows', () => {
    expect(shellsFor('darwin', { SHELL: '/bin/zsh' })).toEqual([{ file: '/bin/zsh', args: ['-l'] }, { file: '/bin/sh', args: ['-l'] }]);
    expect(shellsFor('linux', {})).toEqual([{ file: '/bin/bash', args: ['-l'] }, { file: '/bin/sh', args: ['-l'] }]);
    expect(shellsFor('win32', { ComSpec: 'C:\\Windows\\cmd.exe' })).toEqual([{ file: 'powershell.exe', args: ['-NoLogo'] }, { file: 'C:\\Windows\\cmd.exe', args: [] }]);
  });
});

describe('ending a shell from the app', () => {
  it('reports the exit, so the panel offers Restart instead of going silently dead', async () => {
    const svc = make();
    svc.open('p1', '/repo', 80, 24);
    await svc.kill('p1');
    expect(events).toContainEqual({ type: 'exit', projectId: 'p1', exitCode: 0 });
    expect(svc.size).toBe(0);
  });

  it('kills the whole tree before the shell on Windows, and SIGKILLs a POSIX shell that ignores the hang-up', async () => {
    const order: string[] = [];
    const killTree = vi.fn((_pid: number, sig?: string) => order.push(`tree${sig ? ':' + sig : ''}`));
    const win = make({ platform: 'win32', env: {}, killTree });
    win.open('p1', 'C:\\repo', 80, 24);
    const orig = spawned[0].kill.bind(spawned[0]);
    spawned[0].kill = () => { order.push('pty'); orig(); };
    await win.kill('p1');
    expect(order).toEqual(['tree', 'pty']);

    const stubborn = make({ killTree, platform: 'darwin' });
    stubborn.open('p2', '/repo', 80, 24);
    spawned[1].kill = () => undefined; // ignores SIGHUP
    const done = stubborn.kill('p2');
    await vi.advanceTimersByTimeAsync(3500);
    await done;
    expect(killTree).toHaveBeenLastCalledWith(4242, 'SIGKILL');
  });
});
