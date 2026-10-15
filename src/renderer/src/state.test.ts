import { describe, expect, it } from 'vitest';
import { initialState, reducer, type UiState } from './state';
import type { Agent, WorkspaceSnapshot } from '../../shared/types';

const agent = (id: string, name: string): Agent => ({ id, projectId: 'p', name, roleId: 'frontend', kind: 'employee', status: 'idle', bubble: 'Idle' });
const ws: WorkspaceSnapshot = {
  project: { id: 'p', name: 'demo', repoPath: '/r', baseBranch: 'main', maxConcurrent: 4, autoMerge: false },
  agents: [agent('a', 'Pixel')], tasks: [], chat: [], merges: [],
};
const opened: UiState = reducer(initialState, { type: 'snapshot', ws });
const text = (t: string) => ({ type: 'text' as const, text: t });

describe('ui reducer', () => {
  it('opens on the office view and can navigate', () => {
    expect(opened.view).toEqual({ name: 'office' });
    expect(reducer(opened, { type: 'navigate', view: { name: 'agent', agentId: 'a' } }).view).toEqual({ name: 'agent', agentId: 'a' });
  });

  it('opens on a remembered tab when one is given', () => {
    expect(reducer(initialState, { type: 'snapshot', ws, view: { name: 'history' } }).view).toEqual({ name: 'history' });
  });

  it('leaves an agent page when that agent is fired', () => {
    const s = reducer(opened, { type: 'navigate', view: { name: 'agent', agentId: 'a' } });
    expect(reducer(s, { type: 'event', event: { type: 'agents', agents: [] } }).view).toEqual({ name: 'team' });
  });

  it('applies chat, merges, project changes and closing', () => {
    let s = reducer(opened, { type: 'event', event: { type: 'chat', entry: { kind: 'user', at: 't', text: 'hi' } } });
    s = reducer(s, { type: 'event', event: { type: 'merge-request', request: { requestId: 'r1', taskId: 'T-1', title: 't', agentName: 'Pixel', diffStat: [], summary: '' } } });
    s = reducer(s, { type: 'event', event: { type: 'project', project: { ...ws.project, autoMerge: true } } });
    expect(s.ws!.chat).toHaveLength(1);
    expect(s.ws!.merges).toHaveLength(1);
    expect(s.ws!.project.autoMerge).toBe(true);
    s = reducer(s, { type: 'event', event: { type: 'merge-resolved', requestId: 'r1' } });
    expect(s.ws!.merges).toEqual([]);
    expect(reducer(s, { type: 'closed' })).toMatchObject({ ws: null, view: { name: 'office' } });
  });

  it('keeps timestamped logs, capped, and merges loaded history without duplicates', () => {
    let s = opened;
    for (let i = 0; i < 350; i++) s = reducer(s, { type: 'event', event: { type: 'agent-event', agentId: 'a', event: text(String(i)), at: `2026-10-14T10:00:${String(i).padStart(3, '0')}Z` } });
    expect(s.logs.a).toHaveLength(300);
    let t = reducer(opened, { type: 'event', event: { type: 'agent-event', agentId: 'a', event: text('live'), at: '2026-10-14T10:00:05Z' } });
    t = reducer(t, { type: 'event', event: { type: 'agent-event', agentId: 'a', event: text('older'), at: '2026-10-14T10:00:01Z' } });
    t = reducer(t, { type: 'logs-loaded', agentId: 'a', entries: [{ at: '2026-10-14T10:00:01Z', event: text('older') }, { at: '2026-10-14T10:00:02Z', event: text('disk') }] });
    expect(t.logs.a.map((e) => (e.event as { text: string }).text)).toEqual(['older', 'disk', 'live']);
  });

  it('tracks the streaming boss reply and busy state, clearing the stream when the message lands', () => {
    let s = reducer(opened, { type: 'event', event: { type: 'boss-busy', busy: true } });
    s = reducer(s, { type: 'event', event: { type: 'boss-stream', text: 'Hel' } });
    s = reducer(s, { type: 'event', event: { type: 'boss-stream', text: 'Hello' } });
    expect(s).toMatchObject({ bossBusy: true, bossStream: 'Hello' });
    s = reducer(s, { type: 'event', event: { type: 'chat', entry: { kind: 'boss', at: 't', text: 'Hello' } } });
    expect(s.bossStream).toBeNull();
    s = reducer(s, { type: 'event', event: { type: 'boss-busy', busy: false } });
    expect(s.bossBusy).toBe(false);
    expect(reducer(s, { type: 'snapshot', ws })).toMatchObject({ bossBusy: false, bossStream: null });
  });

  it('stores roles and keeps the last five errors', () => {
    expect(reducer(opened, { type: 'roles', roles: [] }).roles).toEqual([]);
    let s = opened;
    for (let i = 0; i < 7; i++) s = reducer(s, { type: 'error', message: `e${i}` });
    expect(s.errors).toEqual(['e2', 'e3', 'e4', 'e5', 'e6']);
    expect(reducer(s, { type: 'dismiss-error', index: 0 }).errors[0]).toBe('e3');
  });

  it('ignores workspace events before a project is open', () => {
    expect(reducer(initialState, { type: 'event', event: { type: 'tasks', tasks: [] } })).toBe(initialState);
  });
});
