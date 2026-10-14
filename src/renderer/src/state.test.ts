import { describe, expect, it } from 'vitest';
import { initialState, reducer, type UiState } from './state';
import type { WorkspaceSnapshot } from '../../shared/types';

const ws: WorkspaceSnapshot = {
  project: { id: 'p', name: 'demo', repoPath: '/r', baseBranch: 'main', maxConcurrent: 4, bossCanHire: true, autoMerge: false },
  agents: [], tasks: [], chat: [], merges: [],
};
const opened: UiState = reducer(initialState, { type: 'snapshot', ws });

describe('ui reducer', () => {
  it('loads a snapshot and applies list replacements', () => {
    const s = reducer(opened, { type: 'event', event: { type: 'agents', agents: [{ id: 'a', projectId: 'p', name: 'Pixel', roleId: 'frontend', kind: 'employee', status: 'idle', bubble: 'Idle' }] } });
    expect(s.ws!.agents).toHaveLength(1);
  });

  it('appends chat and tracks merge requests until resolved', () => {
    let s = reducer(opened, { type: 'event', event: { type: 'chat', entry: { kind: 'user', at: 't', text: 'hi' } } });
    s = reducer(s, { type: 'event', event: { type: 'merge-request', request: { requestId: 'r1', taskId: 'T-1', title: 't', agentName: 'Pixel', diffStat: [], summary: '' } } });
    expect(s.ws!.chat).toHaveLength(1);
    expect(s.ws!.merges).toHaveLength(1);
    s = reducer(s, { type: 'event', event: { type: 'merge-resolved', requestId: 'r1' } });
    expect(s.ws!.merges).toEqual([]);
  });

  it('caps per-agent logs at 200 events and keeps the latest', () => {
    let s = opened;
    for (let i = 0; i < 250; i++) s = reducer(s, { type: 'event', event: { type: 'agent-event', agentId: 'a', event: { type: 'text', text: String(i) }, at: 't' } });
    expect(s.logs.a).toHaveLength(200);
    expect(s.logs.a.at(-1)).toEqual({ type: 'text', text: '249' });
  });

  it('keeps the last five errors and can dismiss one', () => {
    let s = opened;
    for (let i = 0; i < 7; i++) s = reducer(s, { type: 'event', event: { type: 'error', message: `e${i}` } });
    expect(s.errors).toEqual(['e2', 'e3', 'e4', 'e5', 'e6']);
    expect(reducer(s, { type: 'dismiss-error', index: 0 }).errors[0]).toBe('e3');
  });

  it('ignores workspace events before a project is open', () => {
    expect(reducer(initialState, { type: 'event', event: { type: 'tasks', tasks: [] } })).toBe(initialState);
  });
});
