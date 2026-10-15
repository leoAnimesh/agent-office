import { z } from 'zod';
import type { PreviewInput } from '../../shared/types';

/** Keys the Preview tab may send; printable characters go as text. */
export const PREVIEW_KEYS = ['Enter', 'Tab', 'Shift+Tab', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'] as const;
const frac = z.number().min(0).max(1);
const schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('click'), x: frac, y: frac, button: z.enum(['left', 'right']) }).strict(),
  z.object({ kind: z.literal('wheel'), x: frac, y: frac, dy: z.number().min(-5000).max(5000) }).strict(),
  z.object({ kind: z.literal('key'), key: z.enum(PREVIEW_KEYS) }).strict(),
  z.object({ kind: z.literal('text'), text: z.string().min(1).max(1000) }).strict(),
]);

/** Preview input comes from the renderer: check it before it reaches an employee's tab. */
export function previewInput(v: unknown): PreviewInput {
  const r = schema.safeParse(v);
  if (!r.success) throw new Error('Invalid preview input');
  return r.data;
}
