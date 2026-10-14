import { describe, expect, it } from 'vitest';
import { currentTask, formatLog } from './logView';
import type { Task } from '../../../shared/types';

const at = '2026-10-14T14:29:10.000Z';
const local = new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

describe('formatLog', () => {
  it('formats tool calls with their key argument', () => {
    expect(formatLog({ at, event: { type: 'tool_use', id: '1', name: 'Read', input: { file_path: '/r/src/tokens.css' } } })).toEqual({ time: local, kind: 'tool', text: 'Read /r/src/tokens.css', tone: 'tool' });
    expect(formatLog({ at, event: { type: 'tool_use', id: '1', name: 'Bash', input: { command: 'npm test' } } })!.text).toBe('Bash npm test');
    expect(formatLog({ at, event: { type: 'tool_use', id: '1', name: 'X', input: { a: 1 } } })!.text).toBe('X {"a":1}');
  });

  it('formats results, text, errors and lifecycle events', () => {
    expect(formatLog({ at, event: { type: 'tool_result', toolUseId: '1', isError: false, preview: 'line one\nline two' } })).toMatchObject({ kind: 'result', text: 'line one', tone: 'result' });
    expect(formatLog({ at, event: { type: 'tool_result', toolUseId: '1', isError: true, preview: 'boom' } })).toMatchObject({ tone: 'bad' });
    expect(formatLog({ at, event: { type: 'text', text: 'Hello there' } })).toMatchObject({ kind: 'text', text: 'Hello there', tone: 'text' });
    expect(formatLog({ at, event: { type: 'result', ok: true, text: 'Done', sessionId: 's', costUsd: 0, durationMs: 0, numTurns: 1 } })).toMatchObject({ kind: 'done', tone: 'result' });
    expect(formatLog({ at, event: { type: 'result', ok: false, text: 'nope', sessionId: 's', costUsd: 0, durationMs: 0, numTurns: 1 } })).toMatchObject({ kind: 'failed', tone: 'bad' });
    expect(formatLog({ at, event: { type: 'stderr', text: 'warn' } })).toMatchObject({ kind: 'stderr', tone: 'bad' });
    expect(formatLog({ at, event: { type: 'init', sessionId: 's', model: 'sonnet' } })).toMatchObject({ kind: 'start', text: 'session started (sonnet)', tone: 'meta' });
    expect(formatLog({ at, event: { type: 'exit', code: 0, signal: null } })).toMatchObject({ kind: 'exit', text: 'session ended (0)' });
    expect(formatLog({ at, event: { type: 'thinking' } })).toBeNull();
  });
});

describe('currentTask', () => {
  const t = (id: string, status: Task['status'], updatedAt: string): Task => ({ id, projectId: 'p', title: id, brief: '', assigneeId: 'a', createdBy: 'boss', status, held: false, attempts: 0, branch: 'b', dependsOn: [], createdAt: '', updatedAt });
  it('prefers running work, then the most recently touched open task', () => {
    expect(currentTask('a', [t('T-1', 'review', '2'), t('T-2', 'working', '1')])!.id).toBe('T-2');
    expect(currentTask('a', [t('T-1', 'review', '1'), t('T-3', 'needs_help', '3')])!.id).toBe('T-3');
    expect(currentTask('a', [t('T-1', 'done', '9')])).toBeUndefined();
  });
});
