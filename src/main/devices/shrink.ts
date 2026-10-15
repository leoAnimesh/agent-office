/** Scales a device screenshot down and re-encodes it as JPEG; null when it cannot (then the PNG is used as is). */
export type Shrink = (png: Buffer, maxSide: number, quality: number) => Promise<{ data: Buffer; mime: string; w: number; h: number } | null>;

/** Electron's nativeImage (available in the main process; tests inject their own). */
export const electronShrink: Shrink = async (png, maxSide, quality) => {
  let nativeImage: typeof import('electron').nativeImage | undefined;
  try { nativeImage = (await import('electron')).nativeImage; } catch { return null; }
  if (typeof nativeImage?.createFromBuffer !== 'function') return null;
  let img = nativeImage.createFromBuffer(png);
  if (img.isEmpty()) return null;
  const { width, height } = img.getSize();
  const k = Math.min(1, maxSide / Math.max(width, height));
  if (k < 1) img = img.resize({ width: Math.round(width * k), height: Math.round(height * k), quality: 'good' });
  const size = img.getSize();
  return { data: img.toJPEG(quality), mime: 'image/jpeg', w: size.width, h: size.height };
};
