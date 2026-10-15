import { NO_BROWSER, type PreviewInput, type PreviewTab } from '../../../shared/types';

const KEYS = new Set(['Enter', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);

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

/**
 * Typing in the live view: characters as text, a few named keys. App shortcuts (Ctrl/Cmd/Alt) stay with the app,
 * and Tab is not sent so keyboard users can always move focus out of the view.
 */
export function keyToInput(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): PreviewInput | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if ([...e.key].length === 1) return { kind: 'text', text: e.key };
  return KEYS.has(e.key) ? { kind: 'key', key: e.key } : null;
}

export function statusLine(t: PreviewTab, name: string): string {
  const dev = !t.devServer ? 'no dev server' : t.devServer.running ? 'dev server running' : 'dev server stopped';
  // A dev server without a tab: say where it runs, since there is no page to show.
  if (!t.url) return `${name} · no page open · ${t.devServer?.running ? `dev server running at ${t.devServer.url}` : dev}`;
  return `${name} · ${t.url} · ${dev}`;
}

/** What the Preview tab says when no employee has a tab: a missing browser is said plainly, with an install link. */
export function emptyState(browserAvailable: boolean | null): { text: string; install: boolean } {
  return browserAvailable === false ? { text: NO_BROWSER, install: true } : { text: "An employee's browser tab appears here when it starts testing.", install: false };
}

/** A trackpad fires dozens of wheel events per gesture; a device swipe is slow, so let one through per `ms`. */
export function wheelGate(ms: number): (now: number) => boolean {
  let last = -Infinity;
  return (now) => {
    if (now - last < ms) return false;
    last = now;
    return true;
  };
}
