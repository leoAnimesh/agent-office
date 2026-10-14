// Draws the AgentOffice pixel logo into a PNG with no image libraries (used by electron-builder).
// The pixel grid lives in src/shared/logo.json, shared with the in-app <Logo />.
import { deflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const LOGO = JSON.parse(readFileSync(new URL('../src/shared/logo.json', import.meta.url), 'utf8'));
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** The rows and columns that hold any pixel art. */
export function artBounds() {
  let minX = 16, maxX = -1, minY = 16, maxY = -1;
  LOGO.grid.forEach((row, y) => [...row].forEach((c, x) => {
    if (c === '.') return;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }));
  return { minX, maxX, minY, maxY };
}
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** macOS icon template: an 824px rounded tile centred on a 1024px canvas (scaled for other sizes). */
export function makeIcon(size = 1024) {
  const tile = Math.round(size * 824 / 1024);
  const margin = (size - tile) / 2;
  const radius = tile * 0.225;
  const cell = Math.floor(size * 44 / 1024);
  // Centre the art by its own bounds: an odd-width building can't centre on the even 16-cell grid.
  const b = artBounds();
  const ox = Math.round((size - cell * (b.maxX - b.minX + 1)) / 2) - b.minX * cell;
  const oy = Math.round((size - cell * (b.maxY - b.minY + 1)) / 2) - b.minY * cell;
  const bg = rgb(LOGO.tile);
  const px = Buffer.alloc(size * size * 4);
  const put = (x, y, [r, g, b], a) => { const i = (y * size + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a; };

  // Rounded tile, with a one-pixel soft edge on the corners.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = Math.min(Math.max(x + 0.5, margin + radius), size - margin - radius);
      const cy = Math.min(Math.max(y + 0.5, margin + radius), size - margin - radius);
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const inside = x >= margin && x < size - margin && y >= margin && y < size - margin;
      const a = inside ? Math.max(0, Math.min(1, radius - d + 0.5)) : 0;
      if (a > 0) put(x, y, bg, Math.round(a * 255));
    }
  }
  // The pixel art, one square block per grid cell.
  LOGO.grid.forEach((row, gy) => [...row].forEach((c, gx) => {
    if (c === '.') return;
    const colour = rgb(LOGO.palette[c]);
    for (let y = oy + gy * cell; y < oy + (gy + 1) * cell; y++) {
      for (let x = ox + gx * cell; x < ox + (gx + 1) * cell; x++) put(x, y, colour, 255);
    }
  }));

  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) px.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const out = path.resolve('build/icon.png');
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, makeIcon());
  console.log(`wrote ${out}`);
}
