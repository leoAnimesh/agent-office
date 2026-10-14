import { describe, expect, it } from 'vitest';
import { claudeLabel, readCollapsed, writeCollapsed } from './sidebarPref';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };
const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };

describe('sidebar preference', () => {
  it('defaults to expanded and remembers collapsed', () => {
    const s = mem();
    expect(readCollapsed(s)).toBe(false);
    writeCollapsed(s, true);
    expect(readCollapsed(s)).toBe(true);
    writeCollapsed(s, false);
    expect(readCollapsed(s)).toBe(false);
  });
  it('survives storage that is missing or throws', () => {
    expect(readCollapsed(null)).toBe(false);
    expect(readCollapsed(broken)).toBe(false);
    expect(() => writeCollapsed(broken, true)).not.toThrow();
  });
});

describe('claudeLabel', () => {
  it('shows only the name and version', () => {
    expect(claudeLabel({ path: '/x/claude', version: '2.1.299' })).toEqual({ text: 'Claude Code v2.1.299', title: 'Claude Code v2.1.299 · connected' });
    expect(claudeLabel({ path: '/x/claude', version: null })).toEqual({ text: 'Claude Code', title: 'Claude Code · connected' });
  });
});
