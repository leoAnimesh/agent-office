import { describe, expect, it } from 'vitest';
import { canSend, checkAttachments, formatSize, isImageType, LIMITS, safeName, sniffImage } from './attachments';

const MB = 1024 * 1024;

describe('safeName', () => {
  it('keeps only a clean base name', () => {
    expect(safeName('/Users/me/Desktop/shot.png')).toBe('shot.png');
    expect(safeName('C:\\temp\\a b.txt')).toBe('a b.txt');
    expect(safeName('bad\u0000\u0007name.txt')).toBe('badname.txt');
    expect(safeName('')).toBe('attachment');
    expect([...safeName('é'.repeat(300))]).toHaveLength(120);
  });
});

describe('checkAttachments', () => {
  it('accepts up to 5 within the size limits', () => {
    expect(checkAttachments([{ name: 'a.png', mime: 'image/png', size: 4 * MB }, { name: 'b.pdf', mime: 'application/pdf', size: 9 * MB }])).toEqual({ ok: true });
  });
  it('says what is wrong', () => {
    expect(checkAttachments(Array.from({ length: 6 }, () => ({ name: 'a.txt', mime: 'text/plain', size: 1 })))).toEqual({ ok: false, reason: 'At most 5 attachments per message' });
    expect(checkAttachments([{ name: 'big.png', mime: 'image/png', size: 6 * MB }])).toEqual({ ok: false, reason: 'big.png is larger than 5 MB' });
    expect(checkAttachments([{ name: 'big.zip', mime: 'application/zip', size: 11 * MB }])).toEqual({ ok: false, reason: 'big.zip is larger than 10 MB' });
    expect(checkAttachments(Array.from({ length: 3 }, (_, i) => ({ name: `f${i}.bin`, mime: 'application/octet-stream', size: 8 * MB })))).toEqual({ ok: false, reason: 'Attachments add up to more than 20 MB' });
    expect(checkAttachments([{ name: 'e.txt', mime: 'text/plain', size: 0 }])).toEqual({ ok: false, reason: 'e.txt is empty' });
  });
});

describe('sniffImage', () => {
  it('recognises the four image types by their first bytes', () => {
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBe('image/png');
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImage(new TextEncoder().encode('GIF89a'))).toBe('image/gif');
    expect(sniffImage(new TextEncoder().encode('RIFF\u0000\u0000\u0000\u0000WEBPVP8 '))).toBe('image/webp');
    expect(sniffImage(new TextEncoder().encode('hello'))).toBeNull();
  });
});

describe('small helpers', () => {
  it('works out sending, types and sizes', () => {
    expect(canSend('  ', 0)).toBe(false);
    expect(canSend('  ', 1)).toBe(true);
    expect(canSend('hi', 0)).toBe(true);
    expect(isImageType('image/webp')).toBe(true);
    expect(isImageType('image/svg+xml')).toBe(false);
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(1536)).toBe('1.5 KB');
    expect(formatSize(3 * MB)).toBe('3.0 MB');
    expect(LIMITS.longSide).toBe(1568);
  });
});
