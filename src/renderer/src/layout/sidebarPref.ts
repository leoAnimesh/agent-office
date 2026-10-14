const KEY = 'ao.sidebarCollapsed';

type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void };

/** Per-window UI preference; storage may be missing or blocked, so never throw. */
export function readCollapsed(store: Pick<Store, 'getItem'> | null): boolean {
  try { return store?.getItem(KEY) === '1'; } catch { return false; }
}

export function writeCollapsed(store: Pick<Store, 'setItem'> | null, collapsed: boolean): void {
  try { store?.setItem(KEY, collapsed ? '1' : '0'); } catch { /* not remembered, still works */ }
}

export function claudeLabel(claude: { path: string; version: string | null }): { text: string; title: string } {
  const text = claude.version ? `Claude Code v${claude.version}` : 'Claude Code';
  return { text, title: `${text} · connected` };
}
