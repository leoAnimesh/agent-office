/** Terminal IPC arguments come from the renderer: check them before they reach the PTY. */
export function termSize(cols: unknown, rows: unknown): { cols: number; rows: number } {
  const ok = (n: unknown, max: number): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= max;
  if (!ok(cols, 1000) || !ok(rows, 1000)) throw new Error('Invalid terminal size');
  return { cols, rows };
}

export function termData(v: unknown): string {
  if (typeof v !== 'string') throw new Error('Invalid terminal input');
  if (v.length > 64 * 1024) throw new Error('Terminal input is too long');
  return v;
}
