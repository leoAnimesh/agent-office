import { describe, expect, it } from 'vitest';
import { readLastProject, readProjectUi, writeLastProject, writeProjectUi } from './memory';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };
const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };

describe('last project', () => {
  it('remembers and forgets the last open project folder', () => {
    const s = mem();
    expect(readLastProject(s)).toBeNull();
    writeLastProject(s, '/code/app');
    expect(readLastProject(s)).toBe('/code/app');
    writeLastProject(s, null);
    expect(readLastProject(s)).toBeNull();
  });
  it('works without storage', () => {
    expect(readLastProject(null)).toBeNull();
    expect(readLastProject(broken)).toBeNull();
    expect(() => writeLastProject(broken, '/x')).not.toThrow();
  });
});

describe('per-project screen state', () => {
  it('defaults to the office with the terminal closed', () => {
    expect(readProjectUi(mem(), 'p1')).toEqual({ view: 'office', terminal: false, mergesOnly: false });
  });
  it('merges updates per project', () => {
    const s = mem();
    writeProjectUi(s, 'p1', { view: 'history' });
    writeProjectUi(s, 'p1', { terminal: true, historyBranch: 'dev', mergesOnly: true });
    writeProjectUi(s, 'p2', { view: 'team' });
    expect(readProjectUi(s, 'p1')).toEqual({ view: 'history', terminal: true, historyBranch: 'dev', mergesOnly: true });
    expect(readProjectUi(s, 'p2')).toEqual({ view: 'team', terminal: false, mergesOnly: false });
  });
  it('ignores junk and views that are not tabs', () => {
    const s = mem();
    s.setItem('ao.ui.p1', '{"view":"agent","terminal":"yes","historyBranch":42}');
    expect(readProjectUi(s, 'p1')).toEqual({ view: 'office', terminal: false, mergesOnly: false });
    s.setItem('ao.ui.p2', 'not json');
    expect(readProjectUi(s, 'p2')).toEqual({ view: 'office', terminal: false, mergesOnly: false });
    expect(readProjectUi(broken, 'p1')).toEqual({ view: 'office', terminal: false, mergesOnly: false });
    expect(() => writeProjectUi(broken, 'p1', { view: 'tasks' })).not.toThrow();
  });
});
