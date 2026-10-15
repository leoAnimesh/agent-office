/**
 * Screen state remembered between launches: the last open project, and per project the open tab, whether the
 * terminal was open, and the History filters. A convenience only: blocked or junk storage falls back to defaults.
 */
export type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };

export type RememberedView = 'office' | 'tasks' | 'team' | 'history' | 'preview';
export interface ProjectUi { view: RememberedView; terminal: boolean; historyBranch?: string; mergesOnly: boolean }

const LAST = 'ao.lastProject';
const VIEWS: RememberedView[] = ['office', 'tasks', 'team', 'history', 'preview'];
const uiKey = (projectId: string) => `ao.ui.${projectId}`;

/** localStorage can be missing or throw on access (blocked storage). */
export function localStore(): Store | null {
  try { return window.localStorage; } catch { return null; }
}

export function readLastProject(s: Store | null): string | null {
  try { return s?.getItem(LAST) || null; } catch { return null; }
}

export function writeLastProject(s: Store | null, repoPath: string | null): void {
  try { if (repoPath) s?.setItem(LAST, repoPath); else s?.removeItem(LAST); } catch { /* not remembered */ }
}

export function readProjectUi(s: Store | null, projectId: string): ProjectUi {
  const out: ProjectUi = { view: 'office', terminal: false, mergesOnly: false };
  let raw: unknown;
  try { raw = JSON.parse(s?.getItem(uiKey(projectId)) ?? 'null'); } catch { return out; }
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  if (VIEWS.includes(r.view as RememberedView)) out.view = r.view as RememberedView;
  if (r.terminal === true) out.terminal = true;
  if (typeof r.historyBranch === 'string' && r.historyBranch.length <= 255) out.historyBranch = r.historyBranch;
  if (r.mergesOnly === true) out.mergesOnly = true;
  return out;
}

export function writeProjectUi(s: Store | null, projectId: string, patch: Partial<ProjectUi>): void {
  try { s?.setItem(uiKey(projectId), JSON.stringify({ ...readProjectUi(s, projectId), ...patch })); } catch { /* not remembered */ }
}
