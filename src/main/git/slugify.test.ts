import { describe, expect, it } from 'vitest';
import { parseNumstat, slugify } from './worktrees';

describe('slugify', () => {
  it.each([
    ['Pixel', 'pixel'],
    ['Dr. Who/QA', 'dr-who-qa'],
    ['Zoë', 'zoe'],
    ['../../etc', 'etc'],
    ['   ', 'agent'],
    ['🤖🤖', 'agent'],
    ['A'.repeat(80), 'a'.repeat(40)],
  ])('%s -> %s', (input, out) => {
    expect(slugify(input)).toBe(out);
  });

  it('uses a custom fallback', () => {
    expect(slugify('!!!', 'task')).toBe('task');
  });
});

describe('parseNumstat', () => {
  it('parses text and binary rows', () => {
    expect(parseNumstat('3\t1\tsrc/a.ts\n-\t-\timg.png\n')).toEqual([
      { path: 'src/a.ts', add: 3, del: 1 },
      { path: 'img.png', add: 0, del: 0 },
    ]);
    expect(parseNumstat('')).toEqual([]);
  });
});
