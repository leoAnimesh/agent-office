import { LIMITS, isImageType, safeName } from '../../../shared/attachments';

export interface Pending { key: string; name: string; mime: string; size: number; data: Uint8Array; preview?: string }

export function fitWithin(w: number, h: number, max: number): { w: number; h: number } {
  const long = Math.max(w, h);
  if (long <= max) return { w, h };
  const k = max / long;
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

/** What an image is sent as after it has been scaled (`size` is the size of a PNG encode). */
export function outputType(mime: string, size: number): string {
  if (mime === 'image/gif') return 'image/gif';
  if (mime === 'image/png') return size > LIMITS.image ? 'image/jpeg' : 'image/png';
  return 'image/jpeg';
}

const dataUrl = (bytes: Uint8Array, mime: string) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(s)}`;
};

/** Reads a picked, pasted or dropped file; images are scaled to the model's size and get a preview. */
export async function prepareFile(f: File): Promise<Pending> {
  const key = `${f.name}-${f.size}-${Math.random().toString(36).slice(2)}`;
  const name = safeName(f.name || (f.type.startsWith('image/') ? 'pasted-image.png' : 'attachment'));
  if (!isImageType(f.type)) return { key, name, mime: f.type || 'application/octet-stream', size: f.size, data: new Uint8Array(await f.arrayBuffer()) };
  if (f.type === 'image/gif') {
    const data = new Uint8Array(await f.arrayBuffer());
    return { key, name, mime: f.type, size: data.byteLength, data, preview: dataUrl(data, f.type) };
  }
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(f); } catch { throw new Error(`Could not read ${name}`); }
  const { w, h } = fitWithin(bitmap.width, bitmap.height, LIMITS.longSide);
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  let blob = await canvas.convertToBlob({ type: f.type === 'image/png' ? 'image/png' : 'image/jpeg', quality: 0.85 });
  const mime = outputType(f.type, blob.size);
  if (mime !== blob.type) blob = await canvas.convertToBlob({ type: mime, quality: 0.85 });
  const data = new Uint8Array(await blob.arrayBuffer());
  const finalName = mime === 'image/jpeg' ? name.replace(/\.(png|webp)$/i, '.jpg') : name;
  return { key, name: finalName, mime, size: data.byteLength, data, preview: dataUrl(data, mime) };
}

/** Files to attach from a paste. A paste that also carries text (e.g. from Word or Pages, which add a picture of it) stays text. */
export function filesFromPaste(types: readonly string[], files: File[]): File[] {
  return types.includes('text/plain') ? [] : files;
}
