import { describe, expect, it } from 'vitest';
import { fitWithin, outputType } from './prepare';

describe('fitWithin', () => {
  it('scales the long side down to the limit and keeps the shape', () => {
    expect(fitWithin(3136, 2000, 1568)).toEqual({ w: 1568, h: 1000 });
    expect(fitWithin(1000, 4000, 1568)).toEqual({ w: 392, h: 1568 });
    expect(fitWithin(800, 600, 1568)).toEqual({ w: 800, h: 600 });
  });
});

describe('outputType', () => {
  it('keeps PNG unless it is too big, sends GIF as is, re-encodes the rest as JPEG', () => {
    expect(outputType('image/png', 1_000_000)).toBe('image/png');
    expect(outputType('image/png', 6_000_000)).toBe('image/jpeg');
    expect(outputType('image/gif', 1_000)).toBe('image/gif');
    expect(outputType('image/webp', 1_000)).toBe('image/jpeg');
    expect(outputType('image/jpeg', 1_000)).toBe('image/jpeg');
  });
});
