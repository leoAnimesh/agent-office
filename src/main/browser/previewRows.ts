import type { PreviewTab } from '../../shared/types';
import type { TabInfo } from './browserService';
import type { DevServerInfo } from './devServers';

/** The Preview tab's employee list: anyone with a browser tab or a dev server (a server without a tab can still be stopped). */
export function previewRows(tabs: TabInfo[], servers: { agentId: string; info: DevServerInfo }[]): PreviewTab[] {
  const dev = new Map(servers.map((s) => [s.agentId, { url: s.info.url, running: s.info.running }]));
  const rows: PreviewTab[] = tabs.map((t) => ({ ...t, devServer: dev.get(t.agentId) ?? null }));
  for (const s of servers) if (!tabs.some((t) => t.agentId === s.agentId)) rows.push({ agentId: s.agentId, url: '', title: '', devServer: dev.get(s.agentId)! });
  return rows;
}
