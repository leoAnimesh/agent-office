import type { PreviewInput, PreviewTab } from '../../../shared/types';

const KEYS = new Set(['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);

/** Where a frame of frameW×frameH is drawn inside a box, keeping its shape. */
export function fitRect(boxW: number, boxH: number, frameW: number, frameH: number) {
  const scale = Math.min(boxW / frameW, boxH / frameH);
  const w = frameW * scale;
  const h = frameH * scale;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
}

/** A point in the box as a fraction of the page, or null outside the drawn frame. */
export function toFraction(px: number, py: number, r: { x: number; y: number; w: number; h: number }): { x: number; y: number } | null {
  const x = (px - r.x) / r.w;
  const y = (py - r.y) / r.h;
  return x < 0 || x > 1 || y < 0 || y > 1 ? null : { x, y };
}

/** Typing in the live view: characters as text, a few named keys; app shortcuts (Ctrl/Cmd/Alt) stay with the app. */
export function keyToInput(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): PreviewInput | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if ([...e.key].length === 1) return { kind: 'text', text: e.key };
  if (e.key === 'Tab' && e.shiftKey) return { kind: 'key', key: 'Shift+Tab' };
  return KEYS.has(e.key) ? { kind: 'key', key: e.key } : null;
}

export function statusLine(t: PreviewTab, name: string): string {
  const dev = !t.devServer ? 'no dev server' : t.devServer.running ? 'dev server running' : 'dev server stopped';
  return `${name} · ${t.url} · ${dev}`;
}
