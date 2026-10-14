import { describe, expect, it } from 'vitest';
import { IPC } from './ipc';

describe('IPC channels', () => {
  it('uses unique, namespaced channel names', () => {
    const names = Object.values(IPC);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[a-z]+:[a-z-]+$/);
  });
});
