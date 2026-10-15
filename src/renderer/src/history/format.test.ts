import { describe, expect, it } from 'vitest';
import { diffLineKind, timeAgo } from './format';

describe('timeAgo', () => {
  const now = Date.parse('2026-10-15T12:00:00Z');
  it('says how long ago in plain words', () => {
    expect(timeAgo('2026-10-15T11:59:30Z', now)).toBe('just now');
    expect(timeAgo('2026-10-15T11:55:00Z', now)).toBe('5 min ago');
    expect(timeAgo('2026-10-15T09:00:00Z', now)).toBe('3 h ago');
    expect(timeAgo('2026-10-13T12:00:00Z', now)).toBe('2 days ago');
    expect(timeAgo('2026-10-14T12:00:00Z', now)).toBe('1 day ago');
    expect(timeAgo('2026-06-01T12:00:00Z', now)).toBe('1 Jun 2026');
  });
});

describe('diffLineKind', () => {
  it('classifies unified diff lines', () => {
    expect(diffLineKind('+added')).toBe('add');
    expect(diffLineKind('-removed')).toBe('del');
    expect(diffLineKind('@@ -1,2 +1,3 @@')).toBe('hunk');
    expect(diffLineKind('+++ b/src/a.ts')).toBe('meta');
    expect(diffLineKind('--- a/src/a.ts')).toBe('meta');
    expect(diffLineKind('diff --git a/x b/x')).toBe('meta');
    expect(diffLineKind(' context')).toBe('ctx');
  });
});
