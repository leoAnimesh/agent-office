import { describe, expect, it } from 'vitest';
import { termData, termSize } from './ipcArgs';

describe('terminal IPC arguments', () => {
  it('accepts whole-number sizes in range', () => {
    expect(termSize(120, 30)).toEqual({ cols: 120, rows: 30 });
    for (const bad of [[0, 30], [120, 0], [1.5, 30], ['80', 24], [80, null], [9999, 30], [80, 9999], [NaN, 2]]) {
      expect(() => termSize(bad[0], bad[1])).toThrow(/size/);
    }
  });
  it('accepts strings up to 64 KB of input', () => {
    expect(termData('ls\r')).toBe('ls\r');
    expect(termData('')).toBe('');
    expect(() => termData(42)).toThrow(/input/);
    expect(() => termData('x'.repeat(64 * 1024 + 1))).toThrow(/too long/);
  });
});
