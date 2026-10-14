import { describe, expect, it } from 'vitest';
import { makeIcon } from '../scripts/make-icon.mjs';

describe('makeIcon', () => {
  it('produces a square 1024px PNG', () => {
    const png = makeIcon();
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
    expect(png.readUInt32BE(16)).toBe(1024);
    expect(png.readUInt32BE(20)).toBe(1024);
    expect(png.subarray(-8, -4).toString('ascii')).toBe('IEND');
  });
});
