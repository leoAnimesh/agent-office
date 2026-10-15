import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface Outline { text: string; refs: Map<string, { x: number; y: number }> }
export type DeviceKey = 'back' | 'home' | 'enter' | 'delete' | 'tab';

const EMPTY = '(no readable elements on screen)';
const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#10;/g, ' ').replace(/&amp;/g, '&');
const short = (cls: string) => cls.split('.').pop() || cls;
const clipLabel = (s: string) => [...s.replace(/\s+/g, ' ').trim()].slice(0, 120).join('');

/** uiautomator XML → one line per labelled or clickable node, with refs at the node centres (pixels). */
export function androidOutline(xml: string): Outline {
  const refs = new Map<string, { x: number; y: number }>();
  const lines: string[] = [];
  for (const m of xml.matchAll(/<node\b([^>]*?)\/?>/g)) {
    const a: Record<string, string> = {};
    for (const p of m[1].matchAll(/([\w-]+)="([^"]*)"/g)) a[p[1]] = decode(p[2]);
    const label = clipLabel(a.text || a['content-desc'] || '');
    const clickable = a.clickable === 'true';
    if (!label && !clickable) continue;
    const b = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(a.bounds ?? '');
    if (!b) continue;
    const ref = `a${refs.size + 1}`;
    refs.set(ref, { x: Math.round((+b[1] + +b[3]) / 2), y: Math.round((+b[2] + +b[4]) / 2) });
    lines.push(`- ${short(a.class ?? 'View')}${label ? ` "${label}"` : ''}${clickable ? ' (clickable)' : ''} [ref=${ref}]`);
  }
  return { text: lines.length > 0 ? lines.join('\n') : EMPTY, refs };
}

/** idb describe-all JSON → one line per labelled element, with refs at the element centres (points). */
export function iosOutline(json: string): Outline {
  const refs = new Map<string, { x: number; y: number }>();
  const lines: string[] = [];
  let list: unknown;
  try { list = JSON.parse(json); } catch { return { text: EMPTY, refs }; }
  for (const e of Array.isArray(list) ? list as Record<string, unknown>[] : []) {
    const label = clipLabel(String(e.AXLabel ?? '') || String(e.AXValue ?? ''));
    const f = e.frame as { x: number; y: number; width: number; height: number } | undefined;
    if (!label || !f || e.type === 'Application') continue;
    const ref = `i${refs.size + 1}`;
    refs.set(ref, { x: Math.round(f.x + f.width / 2), y: Math.round(f.y + f.height / 2) });
    lines.push(`- ${String(e.type ?? 'Element')} "${label}" [ref=${ref}]`);
  }
  return { text: lines.length > 0 ? lines.join('\n') : EMPTY, refs };
}

export function parseAdbDevices(out: string): string[] {
  return out.split(/\r?\n/).map((l) => l.trim().split(/\s+/)).filter(([s, st]) => s?.startsWith('emulator-') && st === 'device').map(([s]) => s);
}

export function parseAvds(out: string): string[] {
  return out.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[\w.-]+$/.test(l));
}

export function parseSimulators(json: string): { udid: string; name: string; runtime: string; state: string }[] {
  const out: { udid: string; name: string; runtime: string; state: string; v: number[] }[] = [];
  let data: { devices?: Record<string, { udid: string; name: string; state: string; isAvailable?: boolean }[]> };
  try { data = JSON.parse(json); } catch { return []; }
  for (const [rt, list] of Object.entries(data.devices ?? {})) {
    const m = /iOS-(\d+)-(\d+)/.exec(rt);
    if (!m) continue;
    for (const d of list) if (d.isAvailable !== false && d.name.startsWith('iPhone')) out.push({ udid: d.udid, name: d.name, runtime: `iOS ${m[1]}.${m[2]}`, state: d.state, v: [+m[1], +m[2]] });
  }
  out.sort((a, b) => (b.state === 'Booted' ? 1 : 0) - (a.state === 'Booted' ? 1 : 0) || b.v[0] - a.v[0] || b.v[1] - a.v[1]);
  return out.map(({ v: _v, ...rest }) => rest);
}

/** `adb shell input text` goes through the device's shell: escape it, and spaces become %s. */
export function adbText(text: string): string {
  if (!/^[\x20-\x7e]*$/.test(text)) throw new Error('Android typing supports plain ASCII text only');
  return text.replace(/[\\()<>|;&*~"'`$?[\]{}!#]/g, (c) => `\\${c}`).replace(/ /g, '%s');
}

/** One argument for the device's shell (adb shell joins its arguments into one command line): single-quoted. */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Text for one or more `input text` calls. `input text` turns "%s" into a space, so a literal "%s" is split
 * between two calls ("50%" then "sale"), which types it as written.
 */
export function adbTextChunks(text: string): string[] {
  return text.split(/(?<=%)(?=s)/).map(adbText);
}

/** The first even console port (5554–5682) no listed emulator uses, in any state. */
export function freeEmulatorPort(adbDevicesOut: string): number {
  const used = new Set(adbDevicesOut.split(/\r?\n/).map((l) => /^emulator-(\d+)/.exec(l.trim())?.[1]).filter(Boolean).map(Number));
  for (let p = 5554; p <= 5682; p += 2) if (!used.has(p)) return p;
  throw new Error('Too many emulators are running');
}

export const ANDROID_KEYS: Record<DeviceKey, string> = { back: 'KEYCODE_BACK', home: 'KEYCODE_HOME', enter: 'KEYCODE_ENTER', delete: 'KEYCODE_DEL', tab: 'KEYCODE_TAB' };

/** The emulator reaches the host computer at 10.0.2.2, not localhost. */
export function androidUrl(url: string): string {
  const u = new URL(url);
  if (['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) u.hostname = '10.0.2.2';
  return u.href;
}

/** A path given by an employee, resolved (symlinks too) and required to stay inside its worktree. */
export async function insideWorktree(root: string, p: string): Promise<string> {
  const realRoot = await fs.realpath(root);
  let real: string;
  try { real = await fs.realpath(path.resolve(realRoot, p)); } catch { throw new Error(`${p} was not found in your folder`); }
  const rel = path.relative(realRoot, real);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error(`Install only files inside your folder (${p} is outside it)`);
  return real;
}

export function pngSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
