import type { PreviewTab } from '../../../shared/types';

const KIND = { android: 'Android', ios: 'iOS' } as const;

export function targetLabel(t: PreviewTab, nameOf: (id: string) => string): string {
  if (!t.device) return `${nameOf(t.agentId)} · browser`;
  const d = t.device;
  if (!d.running) return `${KIND[d.kind]} · not running`;
  return `${KIND[d.kind]} · ${d.name ?? 'device'} (${d.holder ? nameOf(d.holder) : 'free'})`;
}

export function deviceStatus(t: PreviewTab, nameOf: (id: string) => string): string {
  const d = t.device!;
  if (!d.running) return `${KIND[d.kind]} · not running`;
  return `${KIND[d.kind]} · ${d.name ?? 'device'} · ${d.holder ? `used by ${nameOf(d.holder)}` : 'free'}${d.canInput ? '' : ' · view only (install idb to tap and type)'}`;
}
