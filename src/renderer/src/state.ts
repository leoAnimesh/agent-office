import type { LogEntry, Role, WorkspaceEvent, WorkspaceSnapshot } from '../../shared/types';

export type View = { name: 'office' } | { name: 'tasks' } | { name: 'team' } | { name: 'settings' } | { name: 'project-settings' } | { name: 'history'; sha?: string } | { name: 'preview' } | { name: 'agent'; agentId: string };

export interface UiState {
  ws: WorkspaceSnapshot | null;
  logs: Record<string, LogEntry[]>;
  errors: string[];
  view: View;
  roles: Role[];
  /** The boss reply as it streams in; null when nothing is being written. */
  bossStream: string | null;
  bossBusy: boolean;
}

export type UiAction =
  /** `view`: the tab to open on (remembered per project); the office when not given. */
  | { type: 'snapshot'; ws: WorkspaceSnapshot; view?: View }
  | { type: 'closed' }
  | { type: 'event'; event: WorkspaceEvent }
  | { type: 'error'; message: string }
  | { type: 'dismiss-error'; index: number }
  | { type: 'navigate'; view: View }
  | { type: 'roles'; roles: Role[] }
  | { type: 'logs-loaded'; agentId: string; entries: LogEntry[] };

export const initialState: UiState = { ws: null, logs: {}, errors: [], view: { name: 'office' }, roles: [], bossStream: null, bossBusy: false };
const LOG_CAP = 300;

export function reducer(s: UiState, a: UiAction): UiState {
  switch (a.type) {
    case 'snapshot': return { ...s, ws: a.ws, logs: {}, view: a.view ?? { name: 'office' }, bossStream: null, bossBusy: false };
    case 'closed': return { ...s, ws: null, logs: {}, view: { name: 'office' }, bossStream: null, bossBusy: false };
    case 'error': return { ...s, errors: [...s.errors, a.message].slice(-5) };
    case 'dismiss-error': return { ...s, errors: s.errors.filter((_, i) => i !== a.index) };
    case 'navigate': return { ...s, view: a.view };
    case 'roles': return { ...s, roles: a.roles };
    case 'logs-loaded': {
      const last = a.entries.at(-1)?.at ?? '';
      const live = (s.logs[a.agentId] ?? []).filter((e) => e.at > last);
      return { ...s, logs: { ...s.logs, [a.agentId]: [...a.entries, ...live].slice(-LOG_CAP) } };
    }
    case 'event': return applyEvent(s, a.event);
  }
}

function applyEvent(s: UiState, e: WorkspaceEvent): UiState {
  if (e.type === 'error') return { ...s, errors: [...s.errors, e.message].slice(-5) };
  if (e.type === 'agent-event') {
    const prev = s.logs[e.agentId] ?? [];
    return { ...s, logs: { ...s.logs, [e.agentId]: [...prev, { at: e.at, event: e.event }].slice(-LOG_CAP) } };
  }
  if (!s.ws) return s;
  switch (e.type) {
    case 'agents': {
      const v = s.view;
      const gone = v.name === 'agent' && !e.agents.some((x) => x.id === v.agentId);
      return { ...s, ws: { ...s.ws, agents: e.agents }, view: gone ? { name: 'team' } : v };
    }
    case 'tasks': return { ...s, ws: { ...s.ws, tasks: e.tasks } };
    case 'chat': return { ...s, ws: { ...s.ws, chat: [...s.ws.chat, e.entry] }, bossStream: e.entry.kind === 'boss' ? null : s.bossStream };
    case 'boss-stream': return { ...s, bossStream: e.text };
    case 'boss-busy': return { ...s, bossBusy: e.busy };
    case 'project': return { ...s, ws: { ...s.ws, project: e.project } };
    case 'merge-request': return { ...s, ws: { ...s.ws, merges: [...s.ws.merges.filter((m) => m.requestId !== e.request.requestId), e.request] } };
    case 'merge-resolved': return { ...s, ws: { ...s.ws, merges: s.ws.merges.filter((m) => m.requestId !== e.requestId) } };
    case 'roles-changed': return s; // handled by App, which reloads the role list
    case 'preview-changed': return s;
    case 'open-projects': return s; // handled by the sidebar // handled by the Preview tab, which lists tabs again
  }
}
