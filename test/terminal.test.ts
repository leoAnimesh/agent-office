import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSpawnPty } from '../src/main/terminal/pty';
import { TerminalService, type TerminalEvent } from '../src/main/terminal/terminalService';

let dir: string;
let svc: TerminalService;
let out: string;
beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ao-term-')));
  svc = new TerminalService({ spawn: await loadSpawnPty() });
  out = '';
  svc.on('event', (e: TerminalEvent) => { if (e.type === 'data') out += e.data; });
});
afterEach(async () => {
  await svc.killAll();
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const until = async (pred: () => boolean, ms = 15000) => {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`timed out; output so far:\n${out}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};

describe('terminal with a real PTY', () => {
  it('runs commands in the project folder', async () => {
    svc.open('p1', dir, 120, 30);
    svc.write('p1', 'echo ao-term-ok\r');
    await until(() => /ao-term-ok[\s\S]*ao-term-ok/.test(out) || (out.match(/ao-term-ok/g) ?? []).length >= 2);
    svc.write('p1', 'pwd\r');
    await until(() => out.includes(path.basename(dir)));
  });

  it('ends the shell when killed and starts a fresh one on the next open', async () => {
    svc.open('p1', dir, 80, 24);
    svc.write('p1', 'echo first\r');
    await until(() => out.includes('first'));
    await svc.killAll();
    out = '';
    expect(svc.open('p1', dir, 80, 24)).toEqual({ backlog: '' });
    svc.write('p1', 'echo second\r');
    await until(() => out.includes('second'));
  });
});
