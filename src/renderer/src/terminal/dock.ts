const KEY = 'ao.terminalHeight';
export const DEFAULT_HEIGHT = 280;
const MIN = 120;

type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void };

/** The panel never hides the app: at least 120 px, at most 70% of the window. */
export function clampHeight(h: number, windowHeight: number): number {
  return Math.round(Math.min(Math.max(h, MIN), Math.max(MIN, windowHeight * 0.7)));
}

/** Per-window preference; storage may be missing or blocked, so never throw. */
export function readHeight(store: Pick<Store, 'getItem'> | null, windowHeight: number): number {
  try {
    const n = Number(store?.getItem(KEY));
    return n > 0 ? clampHeight(n, windowHeight) : DEFAULT_HEIGHT;
  } catch { return DEFAULT_HEIGHT; }
}

export function writeHeight(store: Pick<Store, 'setItem'> | null, h: number): void {
  try { store?.setItem(KEY, String(Math.round(h))); } catch { /* not remembered, still works */ }
}

/** Keyboard resizing for the separator: ArrowUp grows the panel, ArrowDown shrinks it. */
export function keyResize(key: string, h: number, windowHeight: number): number | null {
  if (key === 'ArrowUp') return clampHeight(h + 24, windowHeight);
  if (key === 'ArrowDown') return clampHeight(h - 24, windowHeight);
  return null;
}
