import type { RunnerEvent, WorkspaceEvent, WorkspaceSnapshot } from '../../shared/types';

export interface UiState {
  ws: WorkspaceSnapshot | null;
  logs: Record<string, RunnerEvent[]>;
  errors: string[];
}

export type UiAction =
  | { type: 'snapshot'; ws: WorkspaceSnapshot }
  | { type: 'event'; event: WorkspaceEvent }
  | { type: 'error'; message: string }
  | { type: 'dismiss-error'; index: number };

export const initialState: UiState = { ws: null, logs: {}, errors: [] };
const LOG_CAP = 200;

export function reducer(s: UiState, a: UiAction): UiState {
  switch (a.type) {
    case 'snapshot':
      return { ...s, ws: a.ws, logs: {} };
    case 'error':
      return { ...s, errors: [...s.errors, a.message].slice(-5) };
    case 'dismiss-error':
      return { ...s, errors: s.errors.filter((_, i) => i !== a.index) };
    case 'event':
      return applyEvent(s, a.event);
  }
}

function applyEvent(s: UiState, e: WorkspaceEvent): UiState {
  if (e.type === 'error') return { ...s, errors: [...s.errors, e.message].slice(-5) };
  if (e.type === 'agent-event') {
    const prev = s.logs[e.agentId] ?? [];
    return { ...s, logs: { ...s.logs, [e.agentId]: [...prev, e.event].slice(-LOG_CAP) } };
  }
  if (!s.ws) return s;
  switch (e.type) {
    case 'agents': return { ...s, ws: { ...s.ws, agents: e.agents } };
    case 'tasks': return { ...s, ws: { ...s.ws, tasks: e.tasks } };
    case 'chat': return { ...s, ws: { ...s.ws, chat: [...s.ws.chat, e.entry] } };
    case 'merge-request': return { ...s, ws: { ...s.ws, merges: [...s.ws.merges.filter((m) => m.requestId !== e.request.requestId), e.request] } };
    case 'merge-resolved': return { ...s, ws: { ...s.ws, merges: s.ws.merges.filter((m) => m.requestId !== e.requestId) } };
  }
}
