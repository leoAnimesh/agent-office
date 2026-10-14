import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { artBounds, makeIcon } from '../scripts/make-icon.mjs';
import logo from '../src/shared/logo.json';

/** Decodes the RGBA pixels of a PNG written by makeIcon (filter 0 on every row). */
function pixels(png: Buffer): { size: number; at: (x: number, y: number) => number[] } {
  const size = png.readUInt32BE(16);
  const idat: Buffer[] = [];
  for (let off = 8; off < png.length;) {
    const len = png.readUInt32BE(off);
    if (png.subarray(off + 4, off + 8).toString('ascii') === 'IDAT') idat.push(png.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  return { size, at: (x, y) => [...raw.subarray(y * (size * 4 + 1) + 1 + x * 4, y * (size * 4 + 1) + 1 + x * 4 + 4)] };
}
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

describe('logo grid', () => {
  it('is 16x16 and uses only palette colours', () => {
    expect(logo.grid).toHaveLength(16);
    for (const row of logo.grid) {
      expect(row).toHaveLength(16);
      for (const c of row) if (c !== '.') expect(logo.palette).toHaveProperty(c);
    }
  });
});

describe('makeIcon', () => {
  it('produces a square 1024px PNG', () => {
    const png = makeIcon();
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
    expect(png.readUInt32BE(16)).toBe(1024);
    expect(png.readUInt32BE(20)).toBe(1024);
    expect(png.subarray(-8, -4).toString('ascii')).toBe('IEND');
  });

  it('draws the logo on a rounded tile inside the macOS icon margin', () => {
    const { at } = pixels(makeIcon());
    expect(at(10, 10)[3]).toBe(0);                     // outside the tile: transparent
    expect(at(110, 110)[3]).toBe(0);                   // rounded corner: transparent
    expect(at(512, 105)).toEqual([...rgb(logo.tile), 255]); // top edge of the tile
    // Every grid cell lands on its palette colour (sampled at the cell centre).
    const cell = 44, b = artBounds();
    const ox = Math.round((1024 - cell * (b.maxX - b.minX + 1)) / 2) - b.minX * cell;
    const oy = Math.round((1024 - cell * (b.maxY - b.minY + 1)) / 2) - b.minY * cell;
    logo.grid.forEach((row, y) => [...row].forEach((c, x) => {
      const want = c === '.' ? rgb(logo.tile) : rgb((logo.palette as Record<string, string>)[c]);
      expect(at(ox + x * cell + cell / 2, oy + y * cell + cell / 2).slice(0, 3)).toEqual(want);
    }));
  });
});

describe('makeIcon centring', () => {
  it('centres the art itself, not the grid', () => {
    const { at } = pixels(makeIcon());
    const isTile = (x: number, y: number) => at(x, y).slice(0, 3).join() === rgb(logo.tile).join() && at(x, y)[3] === 255;
    const isArt = (x: number, y: number) => at(x, y)[3] === 255 && !isTile(x, y);
    // Scan the inside of the tile (clear of its rounded corners) for the art's real edges.
    let left = 1024, right = 0, top = 1024, bottom = 0;
    for (let y = 200; y < 824; y += 2) for (let x = 120; x < 904; x += 2) {
      if (!isArt(x, y)) continue;
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    for (let y = 120; y < 200; y += 2) for (let x = 200; x < 824; x += 2) if (isArt(x, y)) { top = Math.min(top, y); }
    for (let y = 824; y < 904; y += 2) for (let x = 200; x < 824; x += 2) if (isArt(x, y)) { bottom = Math.max(bottom, y); }
    expect(Math.abs(left - (1022 - right))).toBeLessThanOrEqual(4);
    expect(Math.abs(top - (1022 - bottom))).toBeLessThanOrEqual(4);
  });
});
