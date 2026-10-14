import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ClaudeRunner } from '../src/main/claude/runner';
import { createClassifier } from '../src/main/agents/classifier';
import { FAKE_CLAUDE } from './helpers/runner';

let dir: string;
let argvOut: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-cls-'));
  argvOut = path.join(dir, 'argv.jsonl');
});
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); });

const classifier = (env: Record<string, string>, timeoutMs?: number) => createClassifier({
  createRunner: (o) => new ClaudeRunner({ ...o, bin: process.execPath, binArgs: [FAKE_CLAUDE], env: { ...process.env, FAKE_CLAUDE_ARGV_OUT: argvOut, ...env } }),
  claudeBin: 'claude', cwd: dir, isolateUserSettings: true, timeoutMs,
});
const input = { title: 'Fix typo', brief: 'README says teh', roleName: 'Writer' };

describe('createClassifier', () => {
  it('runs opus with no tools and maps the size to a model', async () => {
    const pick = await classifier({ FAKE_CLAUDE_RESULT: '{"size":"small","reason":"one word"}' })(input);
    expect(pick).toEqual({ model: 'haiku', size: 'small', reason: 'one word', source: 'classifier' });
    const [launch] = (await fs.readFile(argvOut, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as { argv: string[]; cwd: string });
    expect(launch.argv).toEqual(expect.arrayContaining(['--model', 'opus', '--tools', '', '--setting-sources', 'project,local']));
    expect(launch.argv).not.toContain('--resume');
    expect(await fs.realpath(launch.cwd)).toBe(await fs.realpath(dir));
  });

  it('falls back to sonnet on an unparsable reply', async () => {
    const pick = await classifier({})(input);
    expect(pick).toMatchObject({ model: 'sonnet', source: 'fallback', reason: expect.stringContaining('unreadable reply') });
  });

  it('falls back on an error result or a crash', async () => {
    expect(await classifier({ FAKE_CLAUDE_FAIL: '1' })(input)).toMatchObject({ model: 'sonnet', source: 'fallback' });
    expect(await classifier({ FAKE_CLAUDE_CRASH: '1' })(input)).toMatchObject({ model: 'sonnet', source: 'fallback', reason: expect.stringContaining('exited') });
  });

  it('falls back after the timeout and stops the process', async () => {
    const started = Date.now();
    const pick = await classifier({ FAKE_CLAUDE_HANG: '1' }, 300)(input);
    expect(pick).toMatchObject({ model: 'sonnet', source: 'fallback', reason: expect.stringContaining('timed out') });
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('falls back when the CLI cannot be started', async () => {
    const c = createClassifier({
      createRunner: (o) => new ClaudeRunner({ ...o, bin: path.join(dir, 'no-such-claude') }),
      claudeBin: 'x', cwd: dir, isolateUserSettings: true,
    });
    expect(await c(input)).toMatchObject({ model: 'sonnet', source: 'fallback' });
  });
});
