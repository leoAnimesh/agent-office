import { describe, expect, it } from 'vitest';
import { menuNav } from './menuNav';

describe('menuNav', () => {
  it('moves through items with the arrow keys, wrapping at the ends', () => {
    expect(menuNav('ArrowDown', 0, 3)).toBe(1);
    expect(menuNav('ArrowDown', 2, 3)).toBe(0);
    expect(menuNav('ArrowUp', 0, 3)).toBe(2);
    expect(menuNav('ArrowUp', 1, 3)).toBe(0);
  });
  it('jumps to the first and last item', () => {
    expect(menuNav('Home', 2, 3)).toBe(0);
    expect(menuNav('End', 0, 3)).toBe(2);
  });
  it('ignores other keys', () => {
    expect(menuNav('a', 1, 3)).toBeNull();
    expect(menuNav('Enter', 1, 3)).toBeNull();
  });
});
