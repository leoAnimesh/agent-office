import path from 'node:path';
import { ClaudeRunner } from '../../src/main/claude/runner';
import type { ClaudeLaunch } from '../../src/main/claude/args';
import type { RunnerEvent } from '../../src/shared/types';

export const FAKE_CLAUDE = path.resolve('test/fake-claude/fake-claude.mjs');
export const FIXTURE = path.resolve('test/fixtures/stream/read-file.jsonl');

export function fakeRunner(cwd: string, env: Record<string, string> = {}, launch: ClaudeLaunch = {}, script = FAKE_CLAUDE): ClaudeRunner {
  return new ClaudeRunner({ bin: process.execPath, binArgs: [script], cwd, launch, env: { ...process.env, ...env } });
}

export function collect(runner: { on(e: 'event', l: (ev: RunnerEvent) => void): unknown }): RunnerEvent[] {
  const events: RunnerEvent[] = [];
  runner.on('event', (ev) => events.push(ev));
  return events;
}

export function waitForEvent(
  runner: { on(e: 'event', l: (ev: RunnerEvent) => void): unknown; off(e: 'event', l: (ev: RunnerEvent) => void): unknown },
  pred: (ev: RunnerEvent) => boolean,
  ms = 15000,
): Promise<RunnerEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { runner.off('event', listener); reject(new Error('timed out waiting for runner event')); }, ms);
    const listener = (ev: RunnerEvent) => {
      if (pred(ev)) { clearTimeout(timer); runner.off('event', listener); resolve(ev); }
    };
    runner.on('event', listener);
  });
}
