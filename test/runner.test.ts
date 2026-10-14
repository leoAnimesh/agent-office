import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ClaudeRunner } from '../src/main/claude/runner';
import { FAKE_CLAUDE, FIXTURE, collect, fakeRunner, waitForEvent } from './helpers/runner';

let dir: string;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-run-')); });
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); });

describe('ClaudeRunner', () => {
  it('streams parsed events for a turn and exits cleanly when input ends', async () => {
    const r = fakeRunner(dir, { FAKE_CLAUDE_FIXTURE: FIXTURE });
    const events = collect(r);
    r.start();
    r.send('Read a.txt');
    await waitForEvent(r, (e) => e.type === 'result');
    r.endInput();
    const exit = await waitForEvent(r, (e) => e.type === 'exit');
    expect(exit).toEqual({ type: 'exit', code: 0, signal: null });
    expect(events.map((e) => e.type)).toEqual(['init', 'thinking', 'tool_use', 'tool_result', 'text', 'result', 'exit']);
    expect(r.running).toBe(false);
  });

  it('keeps one session across several turns', async () => {
    const r = fakeRunner(dir);
    r.start();
    r.send('first');
    const a = await waitForEvent(r, (e) => e.type === 'result');
    r.send('second');
    const b = await waitForEvent(r, (e) => e.type === 'result');
    r.endInput();
    await waitForEvent(r, (e) => e.type === 'exit');
    expect(a).toMatchObject({ text: 'echo: first' });
    expect(b).toMatchObject({ text: 'echo: second' });
    expect(a.type === 'result' && b.type === 'result' && a.sessionId === b.sessionId).toBe(true);
  });

  it('passes launch options through as CLI flags in the given cwd', async () => {
    const argvOut = path.join(dir, 'argv.jsonl');
    const r = fakeRunner(dir, { FAKE_CLAUDE_ARGV_OUT: argvOut }, { sessionId: 'sess-123', model: 'haiku', isolateUserSettings: true });
    r.start();
    r.send('x');
    await waitForEvent(r, (e) => e.type === 'result');
    r.endInput();
    await waitForEvent(r, (e) => e.type === 'exit');
    const rec = JSON.parse((await fs.readFile(argvOut, 'utf8')).trim());
    expect(rec.argv).toEqual(expect.arrayContaining(['--session-id', 'sess-123', '--model', 'haiku', '--setting-sources', 'project,local']));
    expect(await fs.realpath(rec.cwd)).toBe(await fs.realpath(dir));
  });

  it('reports a crash with the stderr tail', async () => {
    const r = fakeRunner(dir, { FAKE_CLAUDE_CRASH: '1' });
    r.start();
    r.send('x');
    const exit = await waitForEvent(r, (e) => e.type === 'exit');
    expect(exit).toMatchObject({ code: 3 });
    expect(r.lastStderr).toContain('boom: simulated crash');
  });

  it('stop() kills a hanging session', async () => {
    const r = fakeRunner(dir, { FAKE_CLAUDE_HANG: '1' });
    r.start();
    r.send('x');
    await waitForEvent(r, (e) => e.type === 'init');
    r.stop();
    await waitForEvent(r, (e) => e.type === 'exit', 10000);
    expect(r.running).toBe(false);
  });

  it('stop() force-kills a session that ignores SIGTERM', async () => {
    const r = new ClaudeRunner({ bin: process.execPath, binArgs: [FAKE_CLAUDE], cwd: dir, launch: {}, killGraceMs: 300, env: { ...process.env, FAKE_CLAUDE_HANG: '1', FAKE_CLAUDE_TRAP_TERM: '1' } });
    r.start();
    r.send('x');
    await waitForEvent(r, (e) => e.type === 'init');
    r.stop();
    await waitForEvent(r, (e) => e.type === 'exit', 5000);
    expect(r.running).toBe(false);
  });

  it('works when the script lives in a folder with a space in its name', async () => {
    const spaced = path.join(dir, 'with space');
    await fs.mkdir(spaced);
    const script = path.join(spaced, 'fake claude.mjs');
    await fs.copyFile(FAKE_CLAUDE, script);
    const r = fakeRunner(spaced, {}, {}, script);
    r.start();
    r.send('hello');
    expect(await waitForEvent(r, (e) => e.type === 'result')).toMatchObject({ text: 'echo: hello' });
    r.endInput();
    await waitForEvent(r, (e) => e.type === 'exit');
  });

  it('emits exit (not a throw) when the binary does not exist', async () => {
    const r = new ClaudeRunner({ bin: path.join(dir, 'no-such-claude'), cwd: dir, launch: {} });
    const exited = waitForEvent(r, (e) => e.type === 'exit');
    r.start();
    await exited;
    expect(r.lastStderr).toMatch(/ENOENT|not found|not recognized/i);
  });

  it('refuses to send when not running', () => {
    const r = fakeRunner(dir);
    expect(() => r.send('x')).toThrow(/not running/);
  });
});
