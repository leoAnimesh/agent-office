// Draws the AgentOffice pixel logo into a PNG with no image libraries (used by electron-builder).
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const LOGO = [
  [0, 0, 10, 10, '#F5B942'], [1, 1, 5, 4, '#14151F'], [2, 2, 3, 1, '#52D1BE'], [3, 5, 1, 1, '#14151F'],
  [1, 6, 8, 1, '#8B5A34'], [1, 7, 1, 2, '#8B5A34'], [8, 7, 1, 2, '#8B5A34'], [7, 2, 2, 2, '#14151F'], [7, 4, 2, 2, '#2F9E8F'],
];

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export function makeIcon(size = 1024) {
  const cell = Math.floor(size / 12); // 1-cell transparent margin around the 10x10 logo
  const offset = Math.floor((size - cell * 10) / 2);
  const px = Buffer.alloc(size * size * 4);
  for (const [x, y, w, h, hex] of LOGO) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    for (let yy = offset + y * cell; yy < offset + (y + h) * cell; yy++) {
      for (let xx = offset + x * cell; xx < offset + (x + w) * cell; xx++) {
        const i = (yy * size + xx) * 4;
        px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
      }
    }
  }
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
