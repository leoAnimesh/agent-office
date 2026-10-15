import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { checkAttachments, formatSize, isImageType, safeName, sniffImage } from '../../shared/attachments';
import type { AttachmentMeta, NewAttachment } from '../../shared/types';
import type { ImageBlock } from '../claude/args';

const EXT: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' };
const ID = /^[0-9a-f-]{36}$/;
const KIND_NAMES: Record<string, string> = { 'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/gif': 'GIF', 'image/webp': 'WebP' };

/** Chat attachments of one project, kept under app data with generated names. */
export class AttachmentStore {
  constructor(readonly dir: string) {}

  async save(list: NewAttachment[]): Promise<{ meta: AttachmentMeta[]; images: ImageBlock[]; fileLines: string[] }> {
    const verdict = checkAttachments(list.map((a) => ({ name: a.name, mime: a.mime, size: a.data.byteLength })));
    if (!verdict.ok) throw new Error(verdict.reason);
    // Check every file before writing any, so a refused message stores nothing.
    const prepared = list.map((a) => {
      const name = safeName(a.name);
      const claimsImage = isImageType(a.mime);
      const real = sniffImage(a.data);
      if (claimsImage && real !== a.mime) throw new Error(`${name} is not a ${KIND_NAMES[a.mime]} image`);
      const mime = /^[\w.+-]+\/[\w.+-]+$/.test(a.mime) && a.mime.length <= 100 ? a.mime : 'application/octet-stream';
      const ext = claimsImage ? EXT[a.mime] : (/(\.[a-z0-9]{1,9})$/i.exec(name)?.[1].toLowerCase() ?? '');
      return { id: randomUUID(), name, mime, ext, data: a.data, image: claimsImage };
    });
    await fs.mkdir(this.dir, { recursive: true });
    const meta: AttachmentMeta[] = [];
    const images: ImageBlock[] = [];
    const fileLines: string[] = [];
    for (const p of prepared) {
      const file = path.join(this.dir, `${p.id}${p.ext}`);
      const tmp = `${file}.tmp`;
      await fs.writeFile(tmp, p.data);
      await fs.rename(tmp, file);
      meta.push({ id: p.id, name: p.name, mime: p.mime, size: p.data.byteLength, kind: p.image ? 'image' : 'file' });
      if (p.image) images.push({ mime: p.mime, base64: Buffer.from(p.data).toString('base64') });
      else fileLines.push(`Attached file: ${p.name} (${formatSize(p.data.byteLength)}) at ${file}`);
    }
    return { meta, images, fileLines };
  }

  /** An image attachment as a data URL for the chat history. */
  async readImage(id: string): Promise<string> {
    if (!ID.test(id)) throw new Error('Unknown attachment');
    for (const [mime, ext] of Object.entries(EXT)) {
      const data = await fs.readFile(path.join(this.dir, `${id}${ext}`)).catch(() => null);
      if (data) return `data:${mime};base64,${data.toString('base64')}`;
    }
    throw new Error('Only image attachments can be shown, and this one is unavailable');
  }

  /** Images of an earlier message, for re-sending after a boss restart. */
  async imagesFor(meta: AttachmentMeta[]): Promise<ImageBlock[]> {
    const out: ImageBlock[] = [];
    for (const m of meta) {
      if (m.kind !== 'image') continue;
      const data = await fs.readFile(path.join(this.dir, `${m.id}${EXT[m.mime] ?? ''}`)).catch(() => null);
      if (data) out.push({ mime: m.mime, base64: data.toString('base64') });
    }
    return out;
  }
}
