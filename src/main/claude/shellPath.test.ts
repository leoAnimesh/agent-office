import { describe, expect, it } from 'vitest';
import { mergePathLists } from './shellPath';

describe('mergePathLists', () => {
  it('keeps the original order and appends new entries once', () => {
    expect(mergePathLists('/usr/bin:/bin', '/opt/homebrew/bin:/usr/bin:/home/u/.local/bin', ':')).toBe('/usr/bin:/bin:/opt/homebrew/bin:/home/u/.local/bin');
  });
  it('handles empty inputs', () => {
    expect(mergePathLists('', '/a', ':')).toBe('/a');
    expect(mergePathLists('/a', '', ':')).toBe('/a');
  });
});
