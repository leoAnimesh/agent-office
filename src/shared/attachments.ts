/** Attachment rules shared by the chat box (renderer) and the checks in main. */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
const MB = 1024 * 1024;
export const LIMITS = { count: 5, image: 5 * MB, file: 10 * MB, total: 20 * MB, longSide: 1568 };

export interface AttachmentInput { name: string; mime: string; size: number }

export const isImageType = (mime: string) => (IMAGE_TYPES as readonly string[]).includes(mime);

/** The file's own name only, without folders or control characters, at most 120 characters. */
export function safeName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const base = (name.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return [...base].slice(0, 120).join('') || 'attachment';
}

export function checkAttachments(list: AttachmentInput[]): { ok: true } | { ok: false; reason: string } {
  if (list.length > LIMITS.count) return { ok: false, reason: `At most ${LIMITS.count} attachments per message` };
  let total = 0;
  for (const a of list) {
    const name = safeName(a.name);
    if (a.size <= 0) return { ok: false, reason: `${name} is empty` };
    const max = isImageType(a.mime) ? LIMITS.image : LIMITS.file;
    if (a.size > max) return { ok: false, reason: `${name} is larger than ${max / MB} MB` };
    total += a.size;
  }
  if (total > LIMITS.total) return { ok: false, reason: `Attachments add up to more than ${LIMITS.total / MB} MB` };
  return { ok: true };
}

/** The real image type from the first bytes (a renamed file cannot pass as an image). */
export function sniffImage(b: Uint8Array): (typeof IMAGE_TYPES)[number] | null {
  const at = (i: number, ...bytes: number[]) => bytes.every((x, k) => b[i + k] === x);
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  return null;
}

export const canSend = (text: string, count: number) => text.trim().length > 0 || count > 0;

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / MB).toFixed(1)} MB`;
}
