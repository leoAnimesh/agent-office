import { describe, expect, it } from 'vitest';
import { describeTool, reduceStatus, type LiveState } from './status';

const idle: LiveState = { status: 'idle', bubble: 'Idle' };

describe('describeTool', () => {
  it('names the file being touched, on POSIX and Windows paths', () => {
    expect(describeTool('Edit', { file_path: '/repo/src/ThemeToggle.tsx' })).toBe('Editing ThemeToggle.tsx');
    expect(describeTool('Write', { file_path: 'C:\\repo\\src\\a.ts' })).toBe('Writing a.ts');
    expect(describeTool('Read', { file_path: '/x/README.md' })).toBe('Reading README.md');
  });
  it('summarises other tools', () => {
    expect(describeTool('Bash', { command: 'npm test -- --run ThemeToggle and more words' })).toBe('Running npm test -- --run Theme…');
    expect(describeTool('Grep', { pattern: 'useTheme' })).toBe('Searching "useTheme"');
    expect(describeTool('mcp__agentoffice__assign_task', { agent: 'Pixel' })).toBe('Assigning Pixel');
    expect(describeTool('Mystery', {})).toBe('Using Mystery');
  });
});

describe('reduceStatus', () => {
  it('follows a session from start to finish', () => {
    let s = reduceStatus(idle, { type: 'init', sessionId: 's', model: 'm' });
    expect(s).toEqual({ status: 'thinking', bubble: 'Starting…' });
    s = reduceStatus(s, { type: 'tool_use', id: '1', name: 'Edit', input: { file_path: '/a/b.ts' } });
    expect(s).toEqual({ status: 'working', bubble: 'Editing b.ts' });
    s = reduceStatus(s, { type: 'tool_result', toolUseId: '1', isError: false, preview: '' });
    expect(s.status).toBe('working');
    s = reduceStatus(s, { type: 'text', text: 'All tests pass now and the toggle works in both themes.' });
    expect(s).toEqual({ status: 'thinking', bubble: 'All tests pass now and the toggle works…' });
    s = reduceStatus(s, { type: 'result', ok: true, text: '', sessionId: 's', costUsd: 0, durationMs: 0, numTurns: 1 });
    expect(s).toEqual({ status: 'done', bubble: 'Done' });
    expect(reduceStatus(s, { type: 'exit', code: 0, signal: null })).toEqual({ status: 'done', bubble: 'Done' });
  });

  it('shows an error when the process dies without a result', () => {
    const s = reduceStatus({ status: 'working', bubble: 'x' }, { type: 'exit', code: 3, signal: null });
    expect(s).toEqual({ status: 'error', bubble: 'Exited (3)' });
  });

  it('goes idle after a clean exit while not mid-task', () => {
    expect(reduceStatus({ status: 'thinking', bubble: 'x' }, { type: 'exit', code: 0, signal: null })).toEqual({ status: 'idle', bubble: 'Idle' });
  });
});
