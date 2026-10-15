import { describe, expect, it } from 'vitest';
import { clampHeight, readHeight, writeHeight, keyResize, DEFAULT_HEIGHT } from './dock';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };

describe('terminal dock height', () => {
  it('stays between 120 px and 70% of the window', () => {
    expect(clampHeight(50, 1000)).toBe(120);
    expect(clampHeight(900, 1000)).toBe(700);
    expect(clampHeight(300, 1000)).toBe(300);
  });
  it('is remembered, with a default when nothing (or junk) is stored', () => {
    const s = mem();
    expect(readHeight(s, 1000)).toBe(DEFAULT_HEIGHT);
    writeHeight(s, 333);
    expect(readHeight(s, 1000)).toBe(333);
    s.setItem('ao.terminalHeight', 'banana');
    expect(readHeight(s, 1000)).toBe(DEFAULT_HEIGHT);
    expect(readHeight(null, 1000)).toBe(DEFAULT_HEIGHT);
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readHeight(broken, 1000)).toBe(DEFAULT_HEIGHT);
    expect(() => writeHeight(broken, 200)).not.toThrow();
  });
  it('grows with ArrowUp and shrinks with ArrowDown, 24 px a step', () => {
    expect(keyResize('ArrowUp', 280, 1000)).toBe(304);
    expect(keyResize('ArrowDown', 280, 1000)).toBe(256);
    expect(keyResize('ArrowDown', 130, 1000)).toBe(120);
    expect(keyResize('Enter', 280, 1000)).toBeNull();
  });
});
