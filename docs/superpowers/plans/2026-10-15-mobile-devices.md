# Mobile Devices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Employees can start, drive and screenshot an Android emulator and (on macOS) an iOS Simulator through the `office` MCP server, one employee per device at a time, and the user watches and uses the devices from the Preview tab.

**Architecture:** Pure parsers turn tool output (uiautomator XML, idb JSON, `adb devices`, `simctl list -j`) into outlines with refs. Two drivers (`AndroidDriver`, `IosDriver`) run the platform tools through one `runTool` helper with argv arrays, timeouts and output caps; the tool locations come from `resolveDeviceTools` (or a test override). A per-project `DeviceService` holds each device, tracks which employee has it, streams screenshots to the Preview tab and shuts down only devices it started. Device tools join the employee tools; Preview targets with ids `device:android` / `device:ios` reuse the existing watch/frame/input IPC.

**Tech Stack:** TypeScript, Electron, zod, React, Vitest, Playwright; Android SDK `adb`/`emulator`, Xcode `xcrun simctl`, optional `idb`.

**Spec:** `docs/superpowers/specs/2026-10-15-mobile-devices-design.md`

## Global Constraints

- Every external command: `cross-spawn` with an args array, `windowsHide: true`; 30 s timeout (boot waits 180 s); stdout cap 10 MB for screenshots, 1 MB for text.
- Paths from employees (`.apk`, `.app`) must resolve (after `realpath`) inside that employee's worktree.
- URLs: the part-1 rule (`allowedUrl`); Android rewrites `localhost` / `127.0.0.1` / `[::1]` to `10.0.2.2` after the check.
- One Android and one iOS device per project; one holder at a time; holds released on `work-ended` and `fired`; the user may always use a device from Preview.
- Only devices the app started are shut down (on project close, app quit, or the Preview "Shut down" button).
- iOS only on macOS (`process.platform === 'darwin'`, overridable in tests). iOS taps, typing and the screen outline need `idb`; without it those tools return the install hint `Tapping and typing on iOS need idb: brew install facebook/fb/idb-companion and pip3 install fb-idb`.
- Test hooks are read only when not packaged (`testOverrides.ts`): `AO_DEVICE_TOOLS` (JSON `{ adb?, emulator?, xcrun?, idb?: string[]; platform?: string }`, each a command + leading args).
- Commits: Conventional Commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Gates: `npm run typecheck && npm test && npm run test:e2e`.

## Review Focus

1. A device the user started themselves must never be shut down by the app. Pinned in Task 4 (`attaches to a running emulator and leaves it running on stop`).
2. An `.apk` path with `..` or a symlink pointing outside the worktree is refused. Pinned in Task 1 (`insideWorktree`).
3. Typing text with spaces and shell characters (`a&b "c" $d`) reaches the device intact on Android, not interpreted by the device shell. Pinned in Task 1 (`adbText`) and Task 3 (fake adb receives the escaped argument).
4. A second employee using a held device gets a clear busy error, and gets it after the holder's task ends. Pinned in Task 4.
5. iOS taps are in points, not screenshot pixels (a 3× screen): a Preview click at the middle taps the middle. Pinned in Task 3 (`taps in points`).

---

### Task 1: Pure helpers (parsers, escaping, paths)

**Files:**
- Create: `src/main/devices/parse.ts`
- Test: `src/main/devices/parse.test.ts`

**Interfaces:**
- Produces:

```ts
export interface Outline { text: string; refs: Map<string, { x: number; y: number }> }
export function androidOutline(xml: string): Outline;          // refs a1, a2 … (centre of bounds, pixels)
export function iosOutline(json: string): Outline;             // refs i1, i2 … (centre of frame, points)
export function parseAdbDevices(out: string): string[];        // emulator serials in state "device"
export function parseAvds(out: string): string[];
export function parseSimulators(json: string): { udid: string; name: string; runtime: string; state: string }[]; // available iPhones, newest runtime first
export function adbText(text: string): string;                 // throws on non-ASCII
export const ANDROID_KEYS: Record<DeviceKey, string>;          // 'KEYCODE_…'
export type DeviceKey = 'back' | 'home' | 'enter' | 'delete' | 'tab';
export function androidUrl(url: string): string;               // localhost → 10.0.2.2
export function insideWorktree(root: string, p: string): Promise<string>; // resolved real path or throws
export function pngSize(buf: Buffer): { w: number; h: number } | null;
```

- [ ] **Step 1: Write the failing test** `src/main/devices/parse.test.ts`

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { adbText, androidOutline, androidUrl, insideWorktree, iosOutline, parseAdbDevices, parseAvds, parseSimulators, pngSize } from './parse';

const XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0"><node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.example" content-desc="" clickable="false" bounds="[0,0][1080,2400]"><node index="0" text="Sign in &amp; go" resource-id="com.example:id/title" class="android.widget.TextView" content-desc="" clickable="false" bounds="[100,200][980,300]" /><node index="1" text="" resource-id="com.example:id/email" class="android.widget.EditText" content-desc="Email" clickable="true" bounds="[100,400][980,520]" /><node index="2" text="Continue" resource-id="com.example:id/go" class="android.widget.Button" content-desc="" clickable="true" bounds="[100,600][980,720]" /></node></hierarchy>UI hierchary dumped to: /dev/tty`;

const IDB = JSON.stringify([
  { AXLabel: null, AXValue: null, type: 'Application', frame: { x: 0, y: 0, width: 402, height: 874 } },
  { AXLabel: 'Sign in', AXValue: null, type: 'StaticText', frame: { x: 20, y: 100, width: 200, height: 30 } },
  { AXLabel: 'Email', AXValue: '', type: 'TextField', frame: { x: 20, y: 200, width: 360, height: 44 } },
  { AXLabel: 'Continue', AXValue: null, type: 'Button', frame: { x: 20, y: 300, width: 360, height: 50 } },
]);

describe('androidOutline', () => {
  it('lists labelled and clickable nodes with refs at their centres', () => {
    const o = androidOutline(XML);
    expect(o.text.split('\n')).toEqual([
      '- TextView "Sign in & go" [ref=a1]',
      '- EditText "Email" (clickable) [ref=a2]',
      '- Button "Continue" (clickable) [ref=a3]',
    ]);
    expect(o.refs.get('a3')).toEqual({ x: 540, y: 660 });
  });
  it('says when the screen has nothing to read', () => {
    expect(androidOutline('<hierarchy></hierarchy>').text).toBe('(no readable elements on screen)');
  });
});

describe('iosOutline', () => {
  it('lists labelled elements with refs at their centres, in points', () => {
    const o = iosOutline(IDB);
    expect(o.text.split('\n')).toEqual(['- StaticText "Sign in" [ref=i1]', '- TextField "Email" [ref=i2]', '- Button "Continue" [ref=i3]']);
    expect(o.refs.get('i3')).toEqual({ x: 200, y: 325 });
  });
});

describe('tool output parsing', () => {
  it('reads adb devices, AVDs and simulators', () => {
    expect(parseAdbDevices('List of devices attached\nemulator-5554\tdevice\nemulator-5556\toffline\nR58M\tdevice\n\n')).toEqual(['emulator-5554']);
    expect(parseAvds('INFO    | Storing crashdata\nMedium_Phone\nPixel_8\n')).toEqual(['Medium_Phone', 'Pixel_8']);
    const sims = parseSimulators(JSON.stringify({ devices: {
      'com.apple.CoreSimulator.SimRuntime.iOS-18-0': [{ udid: 'A', name: 'iPhone 16', state: 'Shutdown', isAvailable: true }],
      'com.apple.CoreSimulator.SimRuntime.iOS-26-0': [{ udid: 'B', name: 'iPhone 17', state: 'Booted', isAvailable: true }, { udid: 'C', name: 'iPad Air', state: 'Shutdown', isAvailable: true }, { udid: 'D', name: 'iPhone Old', state: 'Shutdown', isAvailable: false }],
    } }));
    expect(sims.map((s) => s.udid)).toEqual(['B', 'A']);
    expect(sims[0]).toMatchObject({ name: 'iPhone 17', runtime: 'iOS 26.0', state: 'Booted' });
  });
});

describe('adbText', () => {
  it('escapes spaces and shell characters for the device shell', () => {
    expect(adbText('a&b "c" $d')).toBe('a\\&b%s\\"c\\"%s\\$d');
    expect(adbText("it's (ok)")).toBe("it\\'s%s\\(ok\\)");
    expect(() => adbText('héllo')).toThrow(/ASCII/);
  });
});

describe('androidUrl', () => {
  it('points local addresses at the host as the emulator sees it', () => {
    expect(androidUrl('http://localhost:5173/a?b=1')).toBe('http://10.0.2.2:5173/a?b=1');
    expect(androidUrl('http://127.0.0.1:3000/')).toBe('http://10.0.2.2:3000/');
    expect(androidUrl('http://[::1]:3000/')).toBe('http://10.0.2.2:3000/');
  });
});

describe('pngSize', () => {
  it('reads width and height from a PNG header', () => {
    const b = Buffer.alloc(24);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    b.writeUInt32BE(1080, 16); b.writeUInt32BE(2400, 20);
    expect(pngSize(b)).toEqual({ w: 1080, h: 2400 });
    expect(pngSize(Buffer.from('nope'))).toBeNull();
  });
});

describe('insideWorktree', () => {
  let root: string; let outside: string;
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-wt-'));
    outside = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-out-'));
    await fs.mkdir(path.join(root, 'build'), { recursive: true });
    await fs.writeFile(path.join(root, 'build', 'app.apk'), 'x');
    await fs.writeFile(path.join(outside, 'evil.apk'), 'x');
    await fs.symlink(path.join(outside, 'evil.apk'), path.join(root, 'link.apk')).catch(() => undefined);
  });
  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    await fs.rm(outside, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
  it('accepts files inside the worktree and refuses everything else', async () => {
    expect(await insideWorktree(root, 'build/app.apk')).toBe(await fs.realpath(path.join(root, 'build', 'app.apk')));
    await expect(insideWorktree(root, '../' + path.basename(outside) + '/evil.apk')).rejects.toThrow(/inside your folder/);
    await expect(insideWorktree(root, path.join(outside, 'evil.apk'))).rejects.toThrow(/inside your folder/);
    if (process.platform !== 'win32') await expect(insideWorktree(root, 'link.apk')).rejects.toThrow(/inside your folder/);
    await expect(insideWorktree(root, 'missing.apk')).rejects.toThrow(/not found/);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/main/devices/parse.test.ts`
Expected: FAIL — cannot resolve `./parse`.

- [ ] **Step 3: Implement** `src/main/devices/parse.ts`

```ts
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
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`Install only files inside your folder (${p} is outside it)`);
  return real;
}

export function pngSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
```

(The sort in `parseSimulators` puts a booted simulator first, then newest runtime; the test expects `B` (booted, iOS 26) then `A`.)

- [ ] **Step 4: Run it**

Run: `npx vitest run src/main/devices/parse.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/devices
git commit -m "feat(devices): parsers and escaping for Android and iOS tools"
```

---

### Task 2: Running the tools, finding them, and fakes for tests

**Files:**
- Create: `src/main/devices/tools.ts` (`ToolCmd`, `DeviceTools`, `runTool`, `startTool`, `resolveDeviceTools`, `detectDevices`)
- Create: `test/fake-devices/fake-tool.mjs`
- Create: `test/helpers/fakeDevices.ts`
- Test: `test/deviceTools.test.ts`

**Interfaces:**
- Produces:

```ts
export interface ToolCmd { bin: string; pre: string[] }
export interface DeviceTools { platform: NodeJS.Platform; adb?: ToolCmd; emulator?: ToolCmd; xcrun?: ToolCmd; idb?: ToolCmd }
export interface RunResult { code: number | null; stdout: Buffer; stderr: string }
export function runTool(t: ToolCmd, args: string[], o?: { timeoutMs?: number; maxBytes?: number }): Promise<RunResult>;
export function startTool(t: ToolCmd, args: string[]): { pid: number | undefined; exited: Promise<void>; output(): string; kill(): Promise<void> };
export function resolveDeviceTools(env: NodeJS.ProcessEnv, platform?: NodeJS.Platform, override?: DeviceToolsOverride): DeviceTools;
export interface DeviceToolsOverride { adb?: string[]; emulator?: string[]; xcrun?: string[]; idb?: string[]; platform?: string }
export interface DeviceSupport { android: { ok: boolean; avds: string[]; reason?: string }; ios: { ok: boolean; devices: { udid: string; name: string; runtime: string; state: string }[]; idb: boolean; reason?: string } }
export function detectDevices(t: DeviceTools): Promise<DeviceSupport>;
// test helper
export function fakeDevices(): Promise<{ dir: string; override: DeviceToolsOverride; calls(): Promise<string[][]>; cleanup(): Promise<void> }>;
```

- [ ] **Step 1: Write the fake tool** `test/fake-devices/fake-tool.mjs`

```js
#!/usr/bin/env node
// Stand-in for adb, emulator, xcrun and idb. State lives in FAKE_DEVICE_DIR; every call is logged to calls.jsonl.
import fs from 'node:fs';
import path from 'node:path';

const [tool, ...args] = process.argv.slice(2);
const dir = process.env.FAKE_DEVICE_DIR;
const file = (n) => path.join(dir, n);
const has = (n) => fs.existsSync(file(n));
fs.appendFileSync(file('calls.jsonl'), JSON.stringify([tool, ...args]) + '\n');
const out = (s) => process.stdout.write(s);
// A 4×8 PNG header (enough for the size check and to draw).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAICAIAAABVpBlvAAAAEklEQVR4nGNgYGD4z8DAwMAAAAQKAQGHSZn5AAAAAElFTkSuQmCC', 'base64');
const XML = "<?xml version='1.0' ?><hierarchy><node text=\"Continue\" class=\"android.widget.Button\" clickable=\"true\" bounds=\"[0,0][4,8]\" /></hierarchy>";

if (tool === 'emulator') {
  if (args[0] === '-list-avds') { out('Medium_Phone\n'); process.exit(0); }
  if (args[0] === '-avd') {
    fs.writeFileSync(file('android-booted'), args[args.indexOf('-port') + 1] ?? '5554');
    setInterval(() => { if (!has('android-booted')) process.exit(0); }, 100);
  }
} else if (tool === 'adb') {
  const a = args[0] === '-s' ? args.slice(2) : args;
  if (a[0] === 'devices') { out(`List of devices attached\n${has('android-booted') ? `emulator-${fs.readFileSync(file('android-booted'), 'utf8')}\tdevice\n` : ''}\n`); }
  else if (a[0] === 'wait-for-device') { /* ready */ }
  else if (a[0] === 'shell' && a[1] === 'getprop') out('1\n');
  else if (a[0] === 'exec-out' && a[1] === 'uiautomator') out(`${XML}UI hierchary dumped to: /dev/tty`);
  else if (a[0] === 'exec-out' && a[1] === 'screencap') process.stdout.write(PNG);
  else if (a[0] === 'install') out('Performing Streamed Install\nSuccess\n');
  else if (a[0] === 'logcat') out('E/App: boom\n');
  else if (a[0] === 'emu' && a[1] === 'kill') fs.rmSync(file('android-booted'), { force: true });
} else if (tool === 'xcrun') {
  const a = args[0] === 'simctl' ? args.slice(1) : args;
  if (a[0] === 'list') out(JSON.stringify({ devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-26-0': [{ udid: 'SIM-1', name: 'iPhone 17', state: has('ios-booted') ? 'Booted' : 'Shutdown', isAvailable: true }] } }));
  else if (a[0] === 'boot') fs.writeFileSync(file('ios-booted'), a[1]);
  else if (a[0] === 'shutdown') fs.rmSync(file('ios-booted'), { force: true });
  else if (a[0] === 'io') process.stdout.write(PNG);
  else if (a[0] === 'spawn') out('Error: boom\n');
} else if (tool === 'idb') {
  if (args[0] === 'ui' && args[1] === 'describe-all') out(JSON.stringify([
    { AXLabel: null, type: 'Application', frame: { x: 0, y: 0, width: 2, height: 4 } },
    { AXLabel: 'Continue', type: 'Button', frame: { x: 0, y: 0, width: 2, height: 4 } },
  ]));
}
```

- [ ] **Step 2: Write the helper and the failing test**

`test/helpers/fakeDevices.ts`:

```ts
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DeviceToolsOverride } from '../../src/main/devices/tools';

const FAKE = path.resolve('test/fake-devices/fake-tool.mjs');

/** Fake adb / emulator / xcrun / idb sharing one state folder (FAKE_DEVICE_DIR is set on process.env). */
export async function fakeDevices(opts: { idb?: boolean } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-dev-'));
  process.env.FAKE_DEVICE_DIR = dir;
  const cmd = (tool: string) => [process.execPath, FAKE, tool];
  const override: DeviceToolsOverride = { adb: cmd('adb'), emulator: cmd('emulator'), xcrun: cmd('xcrun'), platform: 'darwin', ...(opts.idb === false ? {} : { idb: cmd('idb') }) };
  return {
    dir, override,
    async calls(): Promise<string[][]> {
      const raw = await fs.readFile(path.join(dir, 'calls.jsonl'), 'utf8').catch(() => '');
      return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l) as string[]);
    },
    async cleanup() { await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); },
  };
}
```

`test/deviceTools.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectDevices, resolveDeviceTools, runTool } from '../src/main/devices/tools';
import { fakeDevices } from './helpers/fakeDevices';

let fake: Awaited<ReturnType<typeof fakeDevices>>;
beforeEach(async () => { fake = await fakeDevices(); });
afterEach(async () => { await fake.cleanup(); });

describe('device tools', () => {
  it('runs a tool with an args array and returns its output', async () => {
    const t = resolveDeviceTools({}, 'linux', fake.override);
    const r = await runTool(t.adb!, ['devices']);
    expect(r.code).toBe(0);
    expect(r.stdout.toString()).toContain('List of devices attached');
    expect(await fake.calls()).toEqual([['adb', 'devices']]);
  });

  it('times out a tool that hangs', async () => {
    const t = resolveDeviceTools({}, 'linux', fake.override);
    await expect(runTool({ bin: process.execPath, pre: ['-e', 'setTimeout(() => {}, 60000)'] }, [], { timeoutMs: 300 })).rejects.toThrow(/timed out/);
    expect(t.platform).toBe('darwin');
  });

  it('reports what is available', async () => {
    const support = await detectDevices(resolveDeviceTools({}, 'darwin', fake.override));
    expect(support.android).toMatchObject({ ok: true, avds: ['Medium_Phone'] });
    expect(support.ios).toMatchObject({ ok: true, idb: true, devices: [{ udid: 'SIM-1', name: 'iPhone 17' }] });
  });

  it('explains what is missing', async () => {
    const none = await detectDevices({ platform: 'linux' });
    expect(none.android).toMatchObject({ ok: false, reason: expect.stringMatching(/Android SDK/) });
    expect(none.ios).toMatchObject({ ok: false, reason: expect.stringMatching(/macOS/) });
  });

  it('finds the Android SDK from ANDROID_HOME and the default folders', () => {
    const t = resolveDeviceTools({ ANDROID_HOME: '/sdk' }, 'linux', undefined, (p) => p === '/sdk/platform-tools/adb' || p === '/sdk/emulator/emulator');
    expect(t.adb).toEqual({ bin: '/sdk/platform-tools/adb', pre: [] });
    expect(t.emulator).toEqual({ bin: '/sdk/emulator/emulator', pre: [] });
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run test/deviceTools.test.ts`
Expected: FAIL — cannot resolve `../src/main/devices/tools`.

- [ ] **Step 4: Implement** `src/main/devices/tools.ts`

```ts
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import spawn from 'cross-spawn';
import { killTree } from '../claude/killTree';
import { parseAvds, parseSimulators } from './parse';

export interface ToolCmd { bin: string; pre: string[] }
export interface DeviceTools { platform: NodeJS.Platform; adb?: ToolCmd; emulator?: ToolCmd; xcrun?: ToolCmd; idb?: ToolCmd }
export interface DeviceToolsOverride { adb?: string[]; emulator?: string[]; xcrun?: string[]; idb?: string[]; platform?: string }
export interface RunResult { code: number | null; stdout: Buffer; stderr: string }
export interface DeviceSupport {
  android: { ok: boolean; avds: string[]; reason?: string };
  ios: { ok: boolean; devices: { udid: string; name: string; runtime: string; state: string }[]; idb: boolean; reason?: string };
}

/** Runs a platform tool (argv array, no shell) with a timeout and an output cap. */
export function runTool(t: ToolCmd, args: string[], o: { timeoutMs?: number; maxBytes?: number } = {}): Promise<RunResult> {
  const max = o.maxBytes ?? 1024 * 1024;
  return new Promise((resolve, reject) => {
    const child = spawn(t.bin, [...t.pre, ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    const out: Buffer[] = [];
    let size = 0;
    let err = '';
    let done = false;
    const finish = (fn: () => void) => { if (!done) { done = true; clearTimeout(timer); fn(); } };
    const timer = setTimeout(() => finish(() => { if (child.pid) killTree(child.pid, process.platform, 'SIGKILL'); reject(new Error(`${path.basename(t.pre.at(-1) ?? t.bin)} ${args[0] ?? ''} timed out`)); }), o.timeoutMs ?? 30_000);
    child.stdout?.on('data', (c: Buffer) => { size += c.length; if (size <= max) out.push(c); else if (child.pid) killTree(child.pid); });
    child.stderr?.on('data', (c: Buffer) => { if (err.length < 64 * 1024) err += c.toString('utf8'); });
    child.on('error', (e) => finish(() => reject(e)));
    child.on('close', (code) => finish(() => (size > max ? reject(new Error('The tool sent more output than expected')) : resolve({ code, stdout: Buffer.concat(out), stderr: err }))));
  });
}

/** Starts a long-running tool (the emulator); keeps its last output for error messages. */
export function startTool(t: ToolCmd, args: string[]) {
  const child = spawn(t.bin, [...t.pre, ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  const lines: string[] = [];
  const keep = (c: Buffer) => { lines.push(...c.toString('utf8').split(/\r?\n/).filter(Boolean)); lines.splice(0, Math.max(0, lines.length - 40)); };
  child.stdout?.on('data', keep);
  child.stderr?.on('data', keep);
  const exited = new Promise<void>((resolve) => { child.once('exit', () => resolve()); child.once('error', () => resolve()); });
  return {
    pid: child.pid,
    exited,
    output: () => lines.join('\n'),
    async kill() { if (child.pid && child.exitCode === null) { killTree(child.pid); const t = setTimeout(() => child.pid && killTree(child.pid, process.platform, 'SIGKILL'), 5000); await exited; clearTimeout(t); } },
  };
}

const sdkDirs = (env: NodeJS.ProcessEnv, platform: NodeJS.Platform) => [
  env.ANDROID_HOME, env.ANDROID_SDK_ROOT,
  platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Android', 'sdk') : undefined,
  platform === 'win32' && env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Android', 'Sdk') : undefined,
  platform === 'linux' ? path.join(os.homedir(), 'Android', 'Sdk') : undefined,
].filter((d): d is string => Boolean(d));

function onPath(name: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform, exists: (p: string) => boolean): string | undefined {
  const exts = platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of (env.PATH ?? '').split(path.delimiter).filter(Boolean)) for (const e of exts) {
    const p = path.join(dir, name + e.toLowerCase());
    if (exists(p)) return p;
  }
  return undefined;
}

/** Where adb, emulator, xcrun and idb are (or the test override). */
export function resolveDeviceTools(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform, override?: DeviceToolsOverride, exists: (p: string) => boolean = existsSync): DeviceTools {
  if (override) {
    const cmd = (a?: string[]) => (a && a.length > 0 ? { bin: a[0], pre: a.slice(1) } : undefined);
    return { platform: (override.platform as NodeJS.Platform) ?? platform, adb: cmd(override.adb), emulator: cmd(override.emulator), xcrun: cmd(override.xcrun), idb: cmd(override.idb) };
  }
  const exe = platform === 'win32' ? '.exe' : '';
  const inSdk = (sub: string, name: string) => sdkDirs(env, platform).map((d) => path.join(d, sub, name + exe)).find(exists);
  const tool = (p?: string) => (p ? { bin: p, pre: [] } : undefined);
  return {
    platform,
    adb: tool(inSdk('platform-tools', 'adb') ?? onPath('adb', env, platform, exists)),
    emulator: tool(inSdk('emulator', 'emulator') ?? onPath('emulator', env, platform, exists)),
    xcrun: platform === 'darwin' ? tool(exists('/usr/bin/xcrun') ? '/usr/bin/xcrun' : undefined) : undefined,
    idb: platform === 'darwin' ? tool(onPath('idb', env, platform, exists)) : undefined,
  };
}

export async function detectDevices(t: DeviceTools): Promise<DeviceSupport> {
  const android: DeviceSupport['android'] = { ok: false, avds: [] };
  if (!t.adb || !t.emulator) android.reason = 'No Android SDK found. Install Android Studio, or set ANDROID_HOME to your SDK folder.';
  else {
    android.avds = parseAvds((await runTool(t.emulator, ['-list-avds']).catch(() => null))?.stdout.toString() ?? '');
    if (android.avds.length === 0) android.reason = 'No Android emulator found: create one in Android Studio (Device Manager).';
    else android.ok = true;
  }
  const ios: DeviceSupport['ios'] = { ok: false, devices: [], idb: Boolean(t.idb) };
  if (t.platform !== 'darwin') ios.reason = 'The iOS Simulator needs macOS with Xcode.';
  else if (!t.xcrun) ios.reason = 'Xcode was not found. Install it from the App Store, then open it once.';
  else {
    ios.devices = parseSimulators((await runTool(t.xcrun, ['simctl', 'list', 'devices', 'available', '-j']).catch(() => null))?.stdout.toString() ?? '');
    if (ios.devices.length === 0) ios.reason = 'No iPhone simulator found: add one in Xcode (Window → Devices and Simulators).';
    else ios.ok = true;
  }
  return { android, ios };
}
```

(The `resolveDeviceTools` test passes an `exists` function as the 4th argument; on Windows the joined paths use backslashes — guard that test with `if (process.platform === 'win32') return;` or compare with `path.join`.)

- [ ] **Step 5: Run it**

Run: `npx vitest run test/deviceTools.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/devices/tools.ts test/fake-devices test/helpers/fakeDevices.ts test/deviceTools.test.ts
git commit -m "feat(devices): find and run adb, emulator, simctl and idb"
```

---

### Task 3: Android and iOS drivers

**Files:**
- Create: `src/main/devices/drivers.ts` (`DeviceDriver`, `AndroidDriver`, `IosDriver`)
- Test: `test/deviceDrivers.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers; Task 2 `runTool`, `startTool`, `DeviceTools`.
- Produces:

```ts
export type DeviceKind = 'android' | 'ios';
export interface DeviceInfo { kind: DeviceKind; id: string; name: string; startedByApp: boolean }
export interface DeviceDriver {
  readonly kind: DeviceKind;
  readonly canInput: boolean;
  start(prefer?: string): Promise<DeviceInfo>;
  running(): Promise<boolean>;
  stop(): Promise<void>;                          // only what this driver started
  snapshot(): Promise<Outline>;
  tap(x: number, y: number): Promise<void>;       // device units (Android pixels, iOS points)
  type(text: string): Promise<void>;
  swipe(dir: 'up' | 'down' | 'left' | 'right'): Promise<void>;
  press(key: DeviceKey): Promise<void>;
  install(file: string): Promise<void>;
  launch(appId: string): Promise<void>;
  openUrl(url: string): Promise<void>;
  screenshot(): Promise<Buffer>;
  logs(): Promise<string>;
  screenSize(): Promise<{ w: number; h: number }>; // in tap units
}
export const IDB_HINT: string;
```

- [ ] **Step 1: Write the failing test** `test/deviceDrivers.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AndroidDriver, IosDriver } from '../src/main/devices/drivers';
import { resolveDeviceTools } from '../src/main/devices/tools';
import { fakeDevices } from './helpers/fakeDevices';

let fake: Awaited<ReturnType<typeof fakeDevices>>;
beforeEach(async () => { fake = await fakeDevices(); });
afterEach(async () => { await fake.cleanup(); });
const tools = () => resolveDeviceTools({}, 'darwin', fake.override);
const after = async (from: number) => (await fake.calls()).slice(from);

describe('AndroidDriver', () => {
  it('starts the emulator headless, waits for boot, and stops only what it started', async () => {
    const d = new AndroidDriver(tools(), { bootMs: 10_000 });
    const info = await d.start();
    expect(info).toMatchObject({ kind: 'android', name: 'Medium_Phone', startedByApp: true });
    const avd = (await fake.calls()).find((c) => c[0] === 'emulator' && c[1] === '-avd')!;
    expect(avd).toEqual(expect.arrayContaining(['-no-window', '-no-audio', '-no-boot-anim', '-no-snapshot-save']));
    expect(await d.running()).toBe(true);
    await d.stop();
    expect(await d.running()).toBe(false);
  });

  it('attaches to a running emulator and leaves it running on stop', async () => {
    const starter = new AndroidDriver(tools(), { bootMs: 10_000 });
    await starter.start();
    const d = new AndroidDriver(tools(), { bootMs: 10_000 });
    expect(await d.start()).toMatchObject({ startedByApp: false, id: expect.stringMatching(/^emulator-/) });
    await d.stop();
    expect(await d.running()).toBe(true);
    await starter.stop();
  });

  it('reads the screen, taps, types escaped text, swipes, presses keys and opens local URLs', async () => {
    const d = new AndroidDriver(tools(), { bootMs: 10_000 });
    await d.start();
    const from = (await fake.calls()).length;
    expect((await d.snapshot()).text).toBe('- Button "Continue" (clickable) [ref=a1]');
    await d.tap(2, 4);
    await d.type('a&b c');
    await d.swipe('up');
    await d.press('back');
    await d.openUrl('http://localhost:5173/');
    const shell = (await after(from)).filter((c) => c.includes('shell')).map((c) => c.slice(c.indexOf('shell') + 1).join(' '));
    expect(shell).toEqual([
      'input tap 2 4',
      'input text a\\&b%sc',
      expect.stringMatching(/^input swipe \d+ \d+ \d+ \d+ 250$/),
      'input keyevent KEYCODE_BACK',
      'am start -a android.intent.action.VIEW -d http://10.0.2.2:5173/',
    ]);
    expect((await d.screenshot()).subarray(1, 4).toString()).toBe('PNG');
    expect(await d.screenSize()).toEqual({ w: 4, h: 8 });
    expect(await d.logs()).toContain('boom');
    await d.stop();
  });
});

describe('IosDriver', () => {
  it('boots a simulator, taps in points, and shuts down only what it booted', async () => {
    const d = new IosDriver(tools(), { bootMs: 10_000 });
    expect(await d.start()).toMatchObject({ kind: 'ios', id: 'SIM-1', name: 'iPhone 17', startedByApp: true });
    expect(d.canInput).toBe(true);
    expect((await d.snapshot()).text).toBe('- Button "Continue" [ref=i1]');
    expect(await d.screenSize()).toEqual({ w: 2, h: 4 });
    const from = (await fake.calls()).length;
    await d.tap(1, 2);
    await d.type('hi there');
    await d.press('enter');
    await d.openUrl('http://localhost:3000/');
    expect(await after(from)).toEqual([
      ['idb', 'ui', 'tap', '1', '2', '--udid', 'SIM-1'],
      ['idb', 'ui', 'text', 'hi there', '--udid', 'SIM-1'],
      ['idb', 'ui', 'key', '40', '--udid', 'SIM-1'],
      ['xcrun', 'simctl', 'openurl', 'SIM-1', 'http://localhost:3000/'],
    ]);
    await d.stop();
    expect((await fake.calls()).at(-1)).toEqual(['xcrun', 'simctl', 'shutdown', 'SIM-1']);
  });

  it('says what to install when idb is missing', async () => {
    const noIdb = await fakeDevices({ idb: false });
    const d = new IosDriver(resolveDeviceTools({}, 'darwin', noIdb.override), { bootMs: 10_000 });
    await d.start();
    expect(d.canInput).toBe(false);
    await expect(d.tap(1, 1)).rejects.toThrow(/brew install facebook\/fb\/idb-companion/);
    expect((await d.screenshot()).subarray(1, 4).toString()).toBe('PNG');
    await d.stop();
    await noIdb.cleanup();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run test/deviceDrivers.test.ts`
Expected: FAIL — cannot resolve `../src/main/devices/drivers`.

- [ ] **Step 3: Implement** `src/main/devices/drivers.ts`

```ts
import { ANDROID_KEYS, adbText, androidOutline, androidUrl, iosOutline, parseAdbDevices, parseAvds, parseSimulators, pngSize, type DeviceKey, type Outline } from './parse';
import { runTool, startTool, type DeviceTools, type ToolCmd } from './tools';

export type DeviceKind = 'android' | 'ios';
export interface DeviceInfo { kind: DeviceKind; id: string; name: string; startedByApp: boolean }
export const IDB_HINT = 'Tapping and typing on iOS need idb: brew install facebook/fb/idb-companion and pip3 install fb-idb';

export interface DeviceDriver {
  readonly kind: DeviceKind;
  readonly canInput: boolean;
  start(prefer?: string): Promise<DeviceInfo>;
  running(): Promise<boolean>;
  stop(): Promise<void>;
  snapshot(): Promise<Outline>;
  tap(x: number, y: number): Promise<void>;
  type(text: string): Promise<void>;
  swipe(dir: 'up' | 'down' | 'left' | 'right'): Promise<void>;
  press(key: DeviceKey): Promise<void>;
  install(file: string): Promise<void>;
  launch(appId: string): Promise<void>;
  openUrl(url: string): Promise<void>;
  screenshot(): Promise<Buffer>;
  logs(): Promise<string>;
  screenSize(): Promise<{ w: number; h: number }>;
}

const SHOT = { maxBytes: 10 * 1024 * 1024 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const need = <T>(v: T | undefined, what: string): T => { if (!v) throw new Error(what); return v; };
const ok = async (p: Promise<{ code: number | null; stdout: Buffer; stderr: string }>, what: string) => {
  const r = await p;
  if (r.code !== 0) throw new Error(`${what} failed: ${(r.stderr || r.stdout.toString()).trim().split('\n').slice(-3).join(' ')}`);
  return r;
};
const swipeLine = (w: number, h: number, dir: string) => {
  const [cx, cy, dx, dy] = [w / 2, h / 2, w * 0.3, h * 0.3];
  const m: Record<string, number[]> = { up: [cx, cy + dy, cx, cy - dy], down: [cx, cy - dy, cx, cy + dy], left: [cx + dx, cy, cx - dx, cy], right: [cx - dx, cy, cx + dx, cy] };
  return m[dir].map((n) => String(Math.round(n)));
};

export class AndroidDriver implements DeviceDriver {
  readonly kind = 'android' as const;
  readonly canInput = true;
  private serial: string | null = null;
  private proc: ReturnType<typeof startTool> | null = null;
  private size: { w: number; h: number } | null = null;
  constructor(private readonly t: DeviceTools, private readonly o: { bootMs?: number } = {}) {}

  private get adb(): ToolCmd { return need(this.t.adb, 'No Android SDK found. Install Android Studio, or set ANDROID_HOME to your SDK folder.'); }
  private s(): string[] { return ['-s', need(this.serial ?? undefined, 'Start the Android emulator first (device_start)')]; }
  private shell(...args: string[]) { return ok(runTool(this.adb, [...this.s(), 'shell', ...args]), args[0]); }

  async start(prefer?: string): Promise<DeviceInfo> {
    const running = parseAdbDevices((await runTool(this.adb, ['devices'])).stdout.toString());
    if (running.length > 0) {
      this.serial = running[0];
      return { kind: 'android', id: this.serial, name: this.serial, startedByApp: false };
    }
    const emulator = need(this.t.emulator, 'The Android emulator was not found in your SDK.');
    const avds = parseAvds((await runTool(emulator, ['-list-avds'])).stdout.toString());
    const avd = prefer && avds.includes(prefer) ? prefer : avds[0];
    if (!avd) throw new Error('No Android emulator found: create one in Android Studio (Device Manager).');
    const port = 5554 + 2 * Math.floor(Math.random() * 64);
    this.proc = startTool(emulator, ['-avd', avd, '-no-window', '-no-audio', '-no-boot-anim', '-no-snapshot-save', '-port', String(port)]);
    this.serial = `emulator-${port}`;
    const deadline = Date.now() + (this.o.bootMs ?? 180_000);
    while (Date.now() < deadline) {
      const listed = parseAdbDevices((await runTool(this.adb, ['devices'])).stdout.toString()).includes(this.serial);
      if (listed && (await runTool(this.adb, [...this.s(), 'shell', 'getprop', 'sys.boot_completed'])).stdout.toString().trim() === '1') {
        return { kind: 'android', id: this.serial, name: avd, startedByApp: true };
      }
      await sleep(1000);
    }
    const out = this.proc.output();
    await this.stop();
    throw new Error(`The emulator did not finish starting in time. Last output:\n${out}`);
  }

  async running(): Promise<boolean> {
    if (!this.serial || !this.t.adb) return false;
    return parseAdbDevices((await runTool(this.t.adb, ['devices'])).stdout.toString()).includes(this.serial);
  }

  async stop(): Promise<void> {
    const p = this.proc;
    this.proc = null;
    if (p) {
      await runTool(this.adb, [...this.s(), 'emu', 'kill']).catch(() => undefined);
      await p.kill();
    }
    this.serial = p ? null : this.serial;
  }

  async snapshot(): Promise<Outline> {
    for (let i = 0; i < 2; i++) {
      const r = await runTool(this.adb, [...this.s(), 'exec-out', 'uiautomator', 'dump', '/dev/tty']);
      const xml = r.stdout.toString();
      if (r.code === 0 && xml.includes('<hierarchy')) return androidOutline(xml);
      await sleep(500);
    }
    throw new Error('Could not read the screen (it may be changing or protected). Try device_screenshot.');
  }

  async tap(x: number, y: number) { await this.shell('input', 'tap', String(Math.round(x)), String(Math.round(y))); }
  async type(text: string) { await this.shell('input', 'text', adbText(text)); }
  async swipe(dir: 'up' | 'down' | 'left' | 'right') { const { w, h } = await this.screenSize(); await this.shell('input', 'swipe', ...swipeLine(w, h, dir), '250'); }
  async press(key: DeviceKey) { await this.shell('input', 'keyevent', ANDROID_KEYS[key]); }
  async install(file: string) { await ok(runTool(this.adb, [...this.s(), 'install', '-r', file], { timeoutMs: 180_000 }), 'Install'); }
  async launch(appId: string) { await this.shell('monkey', '-p', appId, '-c', 'android.intent.category.LAUNCHER', '1'); }
  async openUrl(url: string) { await this.shell('am', 'start', '-a', 'android.intent.action.VIEW', '-d', androidUrl(url)); }
  async screenshot(): Promise<Buffer> {
    const r = await ok(runTool(this.adb, [...this.s(), 'exec-out', 'screencap', '-p'], SHOT), 'Screenshot');
    this.size = pngSize(r.stdout) ?? this.size;
    return r.stdout;
  }
  async logs() { return (await runTool(this.adb, [...this.s(), 'logcat', '-d', '-t', '200', '*:W'])).stdout.toString() || 'No warnings or errors.'; }
  async screenSize() { if (!this.size) await this.screenshot(); return need(this.size ?? undefined, 'Could not read the screen size'); }
}

export class IosDriver implements DeviceDriver {
  readonly kind = 'ios' as const;
  private udid: string | null = null;
  private booted = false;
  private size: { w: number; h: number } | null = null;
  constructor(private readonly t: DeviceTools, private readonly o: { bootMs?: number } = {}) {}

  get canInput() { return Boolean(this.t.idb); }
  private get xcrun(): ToolCmd {
    if (this.t.platform !== 'darwin') throw new Error('The iOS Simulator needs macOS with Xcode.');
    return need(this.t.xcrun, 'Xcode was not found. Install it from the App Store, then open it once.');
  }
  private id() { return need(this.udid ?? undefined, 'Start the iOS Simulator first (device_start)'); }
  private idb(...args: string[]) { return ok(runTool(need(this.t.idb, IDB_HINT), [...args, '--udid', this.id()]), args[1] ?? args[0]); }
  private simctl(...args: string[]) { return ok(runTool(this.xcrun, ['simctl', ...args], { timeoutMs: 60_000 }), args[0]); }

  async start(prefer?: string): Promise<DeviceInfo> {
    const sims = parseSimulators((await this.simctl('list', 'devices', 'available', '-j')).stdout.toString());
    const booted = sims.find((s) => s.state === 'Booted');
    if (booted) { this.udid = booted.udid; return { kind: 'ios', id: booted.udid, name: booted.name, startedByApp: false }; }
    const sim = sims.find((s) => s.udid === prefer) ?? sims[0];
    if (!sim) throw new Error('No iPhone simulator found: add one in Xcode (Window → Devices and Simulators).');
    this.udid = sim.udid;
    await this.simctl('boot', sim.udid);
    this.booted = true;
    await ok(runTool(this.xcrun, ['simctl', 'bootstatus', sim.udid], { timeoutMs: this.o.bootMs ?? 180_000 }), 'Boot');
    return { kind: 'ios', id: sim.udid, name: sim.name, startedByApp: true };
  }

  async running(): Promise<boolean> {
    if (!this.udid) return false;
    return parseSimulators((await this.simctl('list', 'devices', 'available', '-j')).stdout.toString()).some((s) => s.udid === this.udid && s.state === 'Booted');
  }

  async stop(): Promise<void> {
    if (this.booted && this.udid) await this.simctl('shutdown', this.udid).catch(() => undefined);
    this.booted = false;
  }

  async snapshot(): Promise<Outline> {
    if (!this.t.idb) throw new Error(`Reading the screen needs idb. ${IDB_HINT}. Meanwhile, use device_screenshot.`);
    return iosOutline((await this.idb('ui', 'describe-all', '--json')).stdout.toString());
  }

  async tap(x: number, y: number) { await this.idb('ui', 'tap', String(Math.round(x)), String(Math.round(y))); }
  async type(text: string) { await this.idb('ui', 'text', text); }
  async swipe(dir: 'up' | 'down' | 'left' | 'right') { const { w, h } = await this.screenSize(); await this.idb('ui', 'swipe', ...swipeLine(w, h, dir)); }
  async press(key: DeviceKey) {
    if (key === 'back') throw new Error('iOS has no Back button; swipe right from the left edge or tap the app\'s back control.');
    if (key === 'home') await this.idb('ui', 'button', 'HOME');
    else await this.idb('ui', 'key', { enter: '40', delete: '42', tab: '43' }[key]);
  }
  async install(file: string) { await this.simctl('install', this.id(), file); }
  async launch(appId: string) { await this.simctl('launch', this.id(), appId); }
  async openUrl(url: string) { await this.simctl('openurl', this.id(), url); }
  async screenshot(): Promise<Buffer> { return (await ok(runTool(this.xcrun, ['simctl', 'io', this.id(), 'screenshot', '--type=png', '-'], SHOT), 'Screenshot')).stdout; }
  async logs() {
    const r = await runTool(this.xcrun, ['simctl', 'spawn', this.id(), 'log', 'show', '--last', '2m', '--style', 'compact', '--predicate', 'messageType >= 16']);
    return r.stdout.toString().split('\n').slice(-200).join('\n') || 'No errors.';
  }
  /** Taps are in points: the Application element's frame from idb (screenshots are in pixels). */
  async screenSize() {
    if (this.size) return this.size;
    const app = (JSON.parse((await this.idb('ui', 'describe-all', '--json')).stdout.toString()) as { type?: string; frame?: { width: number; height: number } }[]).find((e) => e.type === 'Application');
    this.size = need(app?.frame ? { w: app.frame.width, h: app.frame.height } : undefined, 'Could not read the screen size');
    return this.size;
  }
}
```

(In the iOS test the simulator stops with `shutdown` as the last call; in the Android test, starting a second driver while the first is running attaches, and only the first's `stop()` kills the emulator — it also clears the fake's `android-booted` file via `emu kill`.)

- [ ] **Step 4: Run it**

Run: `npx vitest run test/deviceDrivers.test.ts && npm run typecheck`
Expected: PASS; `ps` shows no leftover `fake-tool.mjs emulator` process afterwards.

- [ ] **Step 5: Commit**

```bash
git add src/main/devices/drivers.ts test/deviceDrivers.test.ts
git commit -m "feat(devices): Android emulator and iOS Simulator drivers"
```

---

### Task 4: DeviceService (holds, live view, shutdown)

**Files:**
- Create: `src/main/devices/deviceService.ts`
- Test: `test/deviceService.test.ts`

**Interfaces:**
- Consumes: Task 3 drivers; `PreviewFrame`, `PreviewInput` from shared types.
- Produces:

```ts
export interface DeviceState { kind: DeviceKind; running: boolean; name: string | null; holder: string | null; startedByApp: boolean; canInput: boolean }
export class DeviceService {
  constructor(o: { tools: DeviceTools; prefer?(kind: DeviceKind): string | undefined; nameOf(agentId: string): string; taskOf(agentId: string): string | undefined; onChange?(): void; onFrame?(f: PreviewFrame): void; bootMs?: number; frameMs?: number; drivers?: Partial<Record<DeviceKind, DeviceDriver>> });
  use(agentId: string, kind: DeviceKind): Promise<DeviceDriver>;           // starts if needed, takes the device or throws busy
  refFor(kind: DeviceKind, ref: string): { x: number; y: number };
  setOutline(kind: DeviceKind, o: Outline): void;
  release(agentId: string): void;                                          // all kinds
  states(): Promise<DeviceState[]>;
  startByUser(kind: DeviceKind): Promise<void>;
  shutdownByUser(kind: DeviceKind): Promise<void>;
  watch(kind: DeviceKind | null): void;
  ack(): void;
  input(kind: DeviceKind, e: PreviewInput): Promise<void>;
  takeUserNote(agentId: string, kind: DeviceKind): string | undefined;
  close(): Promise<void>;
}
```

- [ ] **Step 1: Write the failing test** `test/deviceService.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DeviceService } from '../src/main/devices/deviceService';
import { resolveDeviceTools } from '../src/main/devices/tools';
import { fakeDevices } from './helpers/fakeDevices';

let fake: Awaited<ReturnType<typeof fakeDevices>>;
let svc: DeviceService;
const frames: string[] = [];
beforeEach(async () => {
  fake = await fakeDevices();
  frames.length = 0;
  svc = new DeviceService({
    tools: resolveDeviceTools({}, 'darwin', fake.override), bootMs: 10_000, frameMs: 50,
    nameOf: (id) => ({ a1: 'Pixel', a2: 'Byte' })[id] ?? id, taskOf: (id) => ({ a1: 'T-101', a2: 'T-102' })[id],
    onFrame: (f) => { frames.push(f.agentId); svc.ack(); },
  });
});
afterEach(async () => { await svc.close(); await fake.cleanup(); });

describe('DeviceService', () => {
  it('lets one employee hold a device at a time and frees it when their work ends', async () => {
    await svc.use('a1', 'android');
    await expect(svc.use('a2', 'android')).rejects.toThrow('The Android emulator is in use by Pixel (T-101). Try again when that task is finished, or ask the boss to sequence the work.');
    expect(await svc.use('a1', 'android')).toBeTruthy(); // the holder keeps using it
    svc.release('a1');
    await expect(svc.use('a2', 'android')).resolves.toBeTruthy();
    expect((await svc.states()).find((s) => s.kind === 'android')).toMatchObject({ running: true, holder: 'a2', startedByApp: true });
  });

  it('streams frames of the watched device and passes clicks as taps in device units', async () => {
    await svc.use('a1', 'android');
    svc.watch('android');
    await new Promise((r) => setTimeout(r, 400));
    expect(frames.length).toBeGreaterThan(0);
    expect(new Set(frames)).toEqual(new Set(['device:android']));
    const from = (await fake.calls()).length;
    await svc.input('android', { kind: 'click', x: 0.5, y: 0.5, button: 'left' });
    expect((await fake.calls()).slice(from)).toContainEqual(expect.arrayContaining(['input', 'tap', '2', '4']));
    expect(svc.takeUserNote('a1', 'android')).toMatch(/user/i);
    svc.watch(null);
  });

  it('shuts down devices it started on close, and leaves the user\'s own running', async () => {
    await svc.use('a1', 'ios');
    await svc.close();
    expect((await fake.calls()).at(-1)).toEqual(['xcrun', 'simctl', 'shutdown', 'SIM-1']);
  });

  it('reports a missing platform plainly', async () => {
    const none = new DeviceService({ tools: { platform: 'linux' }, nameOf: (x) => x, taskOf: () => undefined });
    await expect(none.use('a1', 'ios')).rejects.toThrow(/macOS/);
    await none.close();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run test/deviceService.test.ts`
Expected: FAIL — cannot resolve `../src/main/devices/deviceService`.

- [ ] **Step 3: Implement** `src/main/devices/deviceService.ts`

```ts
import type { PreviewFrame, PreviewInput } from '../../shared/types';
import { AndroidDriver, IosDriver, type DeviceDriver, type DeviceKind } from './drivers';
import { pngSize, type Outline } from './parse';
import type { DeviceTools } from './tools';

export interface DeviceState { kind: DeviceKind; running: boolean; name: string | null; holder: string | null; startedByApp: boolean; canInput: boolean }
interface Slot { driver: DeviceDriver; name: string | null; started: boolean; startedByApp: boolean; holder: string | null; outline: Outline | null; userAt: number; userNote: boolean; starting: Promise<void> | null }

const LABEL: Record<DeviceKind, string> = { android: 'Android emulator', ios: 'iOS Simulator' };
const USER_QUIET_MS = 30_000;
const KEY: Record<string, 'enter' | 'delete' | 'tab' | 'home' | 'back' | undefined> = { Enter: 'enter', Backspace: 'delete', Delete: 'delete', Escape: 'back', Home: 'home' };

/** The project's emulator and simulator: who is using each, the live view, and shutting down what the app started. */
export class DeviceService {
  private slots: Record<DeviceKind, Slot>;
  private watched: DeviceKind | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;

  constructor(private readonly o: {
    tools: DeviceTools; prefer?(kind: DeviceKind): string | undefined; nameOf(agentId: string): string; taskOf(agentId: string): string | undefined;
    onChange?(): void; onFrame?(f: PreviewFrame): void; bootMs?: number; frameMs?: number; drivers?: Partial<Record<DeviceKind, DeviceDriver>>;
  }) {
    const slot = (driver: DeviceDriver): Slot => ({ driver, name: null, started: false, startedByApp: false, holder: null, outline: null, userAt: 0, userNote: false, starting: null });
    this.slots = {
      android: slot(o.drivers?.android ?? new AndroidDriver(o.tools, { bootMs: o.bootMs })),
      ios: slot(o.drivers?.ios ?? new IosDriver(o.tools, { bootMs: o.bootMs })),
    };
  }

  private async ensure(kind: DeviceKind): Promise<Slot> {
    const s = this.slots[kind];
    if (s.started && await s.driver.running().catch(() => false)) return s;
    if (!s.starting) {
      s.starting = (async () => {
        const info = await s.driver.start(this.o.prefer?.(kind));
        Object.assign(s, { name: info.name, started: true, startedByApp: info.startedByApp, outline: null });
        this.o.onChange?.();
      })().finally(() => { s.starting = null; });
    }
    await s.starting;
    return s;
  }

  async use(agentId: string, kind: DeviceKind): Promise<DeviceDriver> {
    const s = this.slots[kind];
    if (s.holder && s.holder !== agentId) {
      const task = this.o.taskOf(s.holder);
      throw new Error(`The ${LABEL[kind]} is in use by ${this.o.nameOf(s.holder)}${task ? ` (${task})` : ''}. Try again when that task is finished, or ask the boss to sequence the work.`);
    }
    s.holder = agentId;
    try { await this.ensure(kind); } catch (e) { s.holder = null; throw e; }
    this.o.onChange?.();
    return s.driver;
  }

  setOutline(kind: DeviceKind, o: Outline) { this.slots[kind].outline = o; }
  refFor(kind: DeviceKind, ref: string): { x: number; y: number } {
    const p = this.slots[kind].outline?.refs.get(ref);
    if (!p) throw new Error('That ref is not on the screen any more. Take a new device_snapshot and use a ref from it.');
    return p;
  }

  release(agentId: string) {
    let changed = false;
    for (const s of Object.values(this.slots)) if (s.holder === agentId) { s.holder = null; changed = true; }
    if (changed) this.o.onChange?.();
  }

  async states(): Promise<DeviceState[]> {
    return Promise.all((Object.keys(this.slots) as DeviceKind[]).map(async (kind) => {
      const s = this.slots[kind];
      const running = s.started && await s.driver.running().catch(() => false);
      return { kind, running, name: s.name, holder: s.holder, startedByApp: s.startedByApp, canInput: s.driver.canInput };
    }));
  }

  async startByUser(kind: DeviceKind) { await this.ensure(kind); }
  async shutdownByUser(kind: DeviceKind) {
    const s = this.slots[kind];
    if (!s.startedByApp) throw new Error('This device was started outside AgentOffice; close it there.');
    if (this.watched === kind) this.watch(null);
    await s.driver.stop();
    Object.assign(s, { started: false, startedByApp: false, holder: null, outline: null });
    this.o.onChange?.();
  }

  takeUserNote(agentId: string, kind: DeviceKind): string | undefined {
    const s = this.slots[kind];
    if (s.holder !== agentId || !s.userNote) return undefined;
    s.userNote = false;
    return 'The user used this device since your last action; check its screen before continuing.';
  }

  /** Stream screenshots of one device to the Preview tab (null stops). */
  watch(kind: DeviceKind | null) {
    this.watched = kind;
    this.inFlight = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (kind) this.tick();
  }

  ack() { this.inFlight = false; }

  private tick() {
    const kind = this.watched;
    if (!kind) return;
    this.timer = setTimeout(async () => {
      const s = this.slots[kind];
      if (this.watched === kind && !this.inFlight && s.started) {
        const png = await s.driver.screenshot().catch(() => null);
        const size = png ? pngSize(png) : null;
        if (png && size && this.watched === kind) {
          this.inFlight = true;
          this.o.onFrame?.({ agentId: `device:${kind}`, data: png.toString('base64'), width: size.w, height: size.h, mime: 'image/png' });
        }
      }
      this.tick();
    }, this.o.frameMs ?? 330);
  }

  async input(kind: DeviceKind, e: PreviewInput) {
    const s = this.slots[kind];
    if (!s.started) throw new Error(`The ${LABEL[kind]} is not running`);
    const now = Date.now();
    if (now - s.userAt > USER_QUIET_MS) s.userNote = true;
    s.userAt = now;
    if (e.kind === 'click') { const { w, h } = await s.driver.screenSize(); await s.driver.tap(e.x * w, e.y * h); }
    else if (e.kind === 'wheel') await s.driver.swipe(e.dy > 0 ? 'up' : 'down');
    else if (e.kind === 'text') await s.driver.type(e.text);
    else { const k = KEY[e.key]; if (k) await s.driver.press(k); }
  }

  async close() {
    this.watch(null);
    for (const s of Object.values(this.slots)) {
      if (s.startedByApp) await s.driver.stop().catch(() => undefined);
      Object.assign(s, { started: false, startedByApp: false, holder: null });
    }
  }
}
```

`src/shared/types.ts`: `PreviewFrame` gains `mime?: string` (the browser's frames stay JPEG; devices send PNG).

- [ ] **Step 4: Run it**

Run: `npx vitest run test/deviceService.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/devices/deviceService.ts src/shared/types.ts test/deviceService.test.ts
git commit -m "feat(devices): one shared emulator and simulator per project with a live view"
```

---

### Task 5: Device tools for employees, and wiring into the project

**Files:**
- Create: `src/main/devices/deviceTools.ts`
- Modify: `src/main/browser/employeeTools.ts` (export `employeeTool` — the existing `def` helper)
- Modify: `src/main/agents/prompt.ts` (device line in the browser block)
- Modify: `src/main/testOverrides.ts` (`deviceTools` from `AO_DEVICE_TOOLS`)
- Modify: `src/main/index.ts` (pass `deviceTools` override to `ProjectService`)
- Modify: `src/main/workspace/projectService.ts` (create `DeviceService`, add tools to the `office` host, release on `work-ended`/`fired`, close)
- Modify: `src/shared/types.ts` (`Project.androidDevice?`, `Project.iosDevice?`), `src/main/store/validate.ts` (patch schema)
- Test: `test/deviceTools.employee.test.ts`, `src/main/agents/prompt.test.ts`

**Interfaces:**
- Consumes: Task 4 `DeviceService`; `allowedUrl`, `LOCAL_ONLY` (part 1); `insideWorktree` (Task 1).
- Produces: `deviceTools(d: { devices: DeviceService; worktreeOf(agentId: string): string | undefined }): ToolDef[]`; `ProjectServiceDeps.deviceTools?: DeviceToolsOverride`.

- [ ] **Step 1: Write the failing tests**

Append to `src/main/agents/prompt.test.ts` (inside the existing `renderPrompt (browser tools)` describe or a new one):

```ts
  it('tells employees how to use the mobile devices with the browser tools', () => {
    const on = renderPrompt(role, [], { agentName: 'Pixel', bossName: 'Max', branch: 'b', projectName: 'demo', kind: 'employee', browserTools: true });
    expect(on).toContain('`device_start`');
    expect(on).toContain('`device_install`');
  });
```

`test/deviceTools.employee.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DeviceService } from '../src/main/devices/deviceService';
import { deviceTools } from '../src/main/devices/deviceTools';
import { resolveDeviceTools } from '../src/main/devices/tools';
import type { ToolDef } from '../src/main/agents/bossTools';
import { fakeDevices } from './helpers/fakeDevices';

let fake: Awaited<ReturnType<typeof fakeDevices>>;
let devices: DeviceService;
let tools: ToolDef[];
let wt: string;
const call = (name: string, args: unknown, agentId = 'a1') => tools.find((t) => t.name === name)!.run(args, { agentId });

beforeEach(async () => {
  fake = await fakeDevices();
  wt = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-wt-'));
  await fs.writeFile(path.join(wt, 'app.apk'), 'apk');
  devices = new DeviceService({ tools: resolveDeviceTools({}, 'darwin', fake.override), bootMs: 10_000, nameOf: (id) => id, taskOf: () => undefined });
  tools = deviceTools({ devices, worktreeOf: () => wt });
});
afterEach(async () => { await devices.close(); await fake.cleanup(); await fs.rm(wt, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); });

describe('device tools', () => {
  it('exposes the documented tools', () => {
    expect(tools.map((t) => t.name).sort()).toEqual(['device_install', 'device_launch', 'device_logs', 'device_open_url', 'device_press', 'device_release', 'device_screenshot', 'device_snapshot', 'device_start', 'device_swipe', 'device_tap', 'device_type']);
  });

  it('starts, installs from the worktree, launches, reads, taps a ref, screenshots and releases', async () => {
    expect(await call('device_start', { platform: 'android' })).toMatchObject({ name: 'Medium_Phone', booted: true });
    expect(await call('device_install', { platform: 'android', path: 'app.apk' })).toEqual({ installed: 'app.apk' });
    await expect(call('device_install', { platform: 'android', path: '../x.apk' })).rejects.toThrow();
    expect(await call('device_launch', { platform: 'android', app_id: 'com.example' })).toEqual({ launched: 'com.example' });
    expect(await call('device_snapshot', { platform: 'android' })).toContain('[ref=a1]');
    expect(await call('device_tap', { platform: 'android', ref: 'a1' })).toEqual({ ok: true });
    await expect(call('device_tap', { platform: 'android', ref: 'a9' })).rejects.toThrow(/device_snapshot/);
    expect(await call('device_open_url', { platform: 'android', url: 'http://localhost:3000/' })).toEqual({ opened: 'http://localhost:3000/' });
    await expect(call('device_open_url', { platform: 'android', url: 'https://example.com' })).rejects.toThrow(/Only local addresses/);
    expect(await call('device_screenshot', { platform: 'android' })).toMatchObject({ type: 'image', mimeType: 'image/png' });
    expect(await call('device_release', { platform: 'android' })).toEqual({ released: true });
  });

  it('refuses calls without a caller', async () => {
    await expect(tools.find((t) => t.name === 'device_start')!.run({ platform: 'android' }, {})).rejects.toThrow(/employee/);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run test/deviceTools.employee.test.ts src/main/agents/prompt.test.ts`
Expected: FAIL — cannot resolve `deviceTools`; prompt lacks `device_start`.

- [ ] **Step 3: Implement**

In `src/main/browser/employeeTools.ts`, rename `function def` to `export function employeeTool` and update its uses.

`src/main/devices/deviceTools.ts`:

```ts
import { z } from 'zod';
import type { ToolDef, ToolImage } from '../agents/bossTools';
import { employeeTool as def } from '../browser/employeeTools';
import { LOCAL_ONLY, allowedUrl } from '../browser/rules';
import type { DeviceService } from './deviceService';
import { insideWorktree } from './parse';

const PLATFORM = z.enum(['android', 'ios']);
const KEYS = z.enum(['back', 'home', 'enter', 'delete', 'tab']);

export function deviceTools(d: { devices: DeviceService; worktreeOf(agentId: string): string | undefined }): ToolDef[] {
  const { devices } = d;
  const note = <T extends object>(agentId: string, platform: 'android' | 'ios', v: T): T & { note?: string } => {
    const n = devices.takeUserNote(agentId, platform);
    return n ? { ...v, note: n } : v;
  };
  return [
    def('device_start', 'Start (or attach to) the Android emulator or iOS Simulator and take it for your task. Only one employee can use each at a time.', { platform: PLATFORM },
      async ({ platform }, agentId) => { await devices.use(agentId, platform); const s = (await devices.states()).find((x) => x.kind === platform)!; return { name: s.name, booted: true, can_tap: s.canInput }; }),
    def('device_install', 'Install an app you built: an .apk (Android) or .app folder (iOS) inside your folder.', { platform: PLATFORM, path: z.string().min(1).max(500) },
      async ({ platform, path: p }, agentId) => {
        const root = d.worktreeOf(agentId);
        if (!root) throw new Error('You have no working folder yet; start a task first.');
        const file = await insideWorktree(root, p);
        await (await devices.use(agentId, platform)).install(file);
        return { installed: p };
      }),
    def('device_launch', 'Launch an installed app by its id (Android package name or iOS bundle id).', { platform: PLATFORM, app_id: z.string().regex(/^[A-Za-z0-9_.-]{1,200}$/) },
      async ({ platform, app_id }, agentId) => { await (await devices.use(agentId, platform)).launch(app_id); return note(agentId, platform, { launched: app_id }); }),
    def('device_open_url', 'Open a local URL (localhost / 127.0.0.1) in the device\'s browser; on Android it reaches your dev server through the emulator.', { platform: PLATFORM, url: z.string().min(1).max(2000) },
      async ({ platform, url }, agentId) => { if (!allowedUrl(url)) throw new Error(LOCAL_ONLY); await (await devices.use(agentId, platform)).openUrl(url); return note(agentId, platform, { opened: url }); }),
    def('device_snapshot', 'Read the screen as a list of elements with [ref=…] ids for device_tap. Refs change after every snapshot.', { platform: PLATFORM },
      async ({ platform }, agentId) => {
        const o = await (await devices.use(agentId, platform)).snapshot();
        devices.setOutline(platform, o);
        const n = devices.takeUserNote(agentId, platform);
        const text = o.text.length > 40 * 1024 ? `${o.text.slice(0, 40 * 1024)}\n… (cut at 40 KB)` : o.text;
        return `${n ? `${n}\n` : ''}${text}`;
      }),
    def('device_tap', 'Tap an element by its ref from the latest device_snapshot, or at x,y in device units.', { platform: PLATFORM, ref: z.string().max(20).optional(), x: z.number().min(0).max(10000).optional(), y: z.number().min(0).max(10000).optional() },
      async ({ platform, ref, x, y }, agentId) => {
        const dev = await devices.use(agentId, platform);
        const p = ref ? devices.refFor(platform, ref) : x !== undefined && y !== undefined ? { x, y } : null;
        if (!p) throw new Error('Give a ref from device_snapshot, or both x and y');
        await dev.tap(p.x, p.y);
        return note(agentId, platform, { ok: true });
      }),
    def('device_type', 'Type text into the focused field (tap the field first).', { platform: PLATFORM, text: z.string().min(1).max(2000) },
      async ({ platform, text }, agentId) => { await (await devices.use(agentId, platform)).type(text); return note(agentId, platform, { ok: true }); }),
    def('device_swipe', 'Swipe across the middle of the screen (up scrolls down the page).', { platform: PLATFORM, direction: z.enum(['up', 'down', 'left', 'right']) },
      async ({ platform, direction }, agentId) => { await (await devices.use(agentId, platform)).swipe(direction); return note(agentId, platform, { ok: true }); }),
    def('device_press', 'Press a device key: back (Android only), home, enter, delete or tab.', { platform: PLATFORM, key: KEYS },
      async ({ platform, key }, agentId) => { await (await devices.use(agentId, platform)).press(key); return note(agentId, platform, { ok: true }); }),
    def('device_screenshot', 'Take a screenshot of the device screen.', { platform: PLATFORM },
      async ({ platform }, agentId) => {
        const png = await (await devices.use(agentId, platform)).screenshot();
        const image: ToolImage = { type: 'image', data: png.toString('base64'), mimeType: 'image/png', note: devices.takeUserNote(agentId, platform) };
        return image;
      }),
    def('device_logs', 'Recent warnings and errors from the device log.', { platform: PLATFORM },
      async ({ platform }, agentId) => (await devices.use(agentId, platform)).logs()),
    def('device_release', 'Let other employees use the device now (it is also released when your task ends).', { platform: PLATFORM },
      async (_a, agentId) => { devices.release(agentId); return { released: true }; }),
  ];
}
```

(Screenshots larger than 1568 px on the long side are sent as they are in this version; the model downscales them. Record a ruling if the spec's "scaled" wording is not met.)

`src/main/agents/prompt.ts`: the browser bullet becomes:

```ts
        ...(ctx.browserTools ? [
          '- To check UI work: `start_dev_server` with the project\'s dev command, `browser_open` the URL it returns, use `browser_snapshot`, `browser_click`, `browser_type` and `browser_screenshot` to verify, and say in your summary what you checked.',
          '- For mobile apps: `device_start` (android or ios), install what you built with `device_install`, `device_launch`, then `device_snapshot` / `device_tap` / `device_type` and `device_screenshot` to verify. Use `device_open_url` for mobile web.',
        ] : []),
```

`src/main/testOverrides.ts`: `TestOverrides` gains `deviceTools?: DeviceToolsOverride;` parsed from `env.AO_DEVICE_TOOLS` (JSON object; ignore broken JSON), only when not packaged. `src/main/index.ts` passes `deviceTools: OVR.deviceTools` into `ProjectService`.

`src/shared/types.ts`: `Project` gains `androidDevice?: string` (AVD name) and `iosDevice?: string` (UDID); `ProjectPatch` gains both; `validate.ts` `projectPatchSchema` gains `androidDevice: z.string().max(200).optional(), iosDevice: z.string().max(200).optional()`.

`src/main/workspace/projectService.ts` in `open()`:

```ts
    const devices = new DeviceService({
      tools: resolveDeviceTools(process.env, process.platform, this.d.deviceTools),
      prefer: (kind) => (kind === 'android' ? project.androidDevice : project.iosDevice) || undefined,
      nameOf: (agentId) => managerRef?.findAgent(agentId)?.name ?? 'an employee',
      taskOf: (agentId) => managerRef?.tasks().find((t) => t.assigneeId === agentId && t.status === 'working')?.id,
      onChange: previewChanged,
      onFrame: (f) => { if (ws && this.ws === ws) this.emit('preview-frame', f); },
    });
    const office = new McpHost([...employeeTools({ browser, devServers }), ...deviceTools({ devices, worktreeOf: (agentId) => managerRef?.agents().find((a) => a.id === agentId)?.worktreePath })], 'office');
```

(replacing the existing `office` construction), add `devices` to `Workspace` and the `ws = {…}` object, and:
- `forward()`: `work-ended` also calls `ws.devices.release(e.agentId)`; `fired` also calls `ws.devices.release(e.agentId)`.
- `close()`: after `await ws.browser.close();` add `await ws.devices.close();`.
- `ProjectServiceDeps` gains `deviceTools?: DeviceToolsOverride`.

- [ ] **Step 4: Run them**

Run: `npx vitest run test/deviceTools.employee.test.ts src/main/agents/prompt.test.ts test/teamBrowser.test.ts && npm run typecheck`
Expected: PASS. Then `npm test` → all pass.

- [ ] **Step 5: Commit**

```bash
git add src/main src/shared test
git commit -m "feat(devices): device tools for employees through the office MCP server"
```

---

### Task 6: Preview and settings

**Files:**
- Modify: `src/main/workspace/projectService.ts` (`previewList` includes devices; device routes for watch/ack/input; `previewDevice(kind, action)`; `deviceSupport()`)
- Modify: `src/shared/types.ts` (`PreviewTab.device?`), `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/index.ts`
- Create: `src/renderer/src/preview/targets.ts` + test (labels, status lines for devices)
- Modify: `src/renderer/src/components/PreviewView.tsx` (Show picker, device buttons, PNG frames, read-only note)
- Modify: `src/renderer/src/components/AppSettingsView.tsx` (Mobile devices section)
- Modify: `src/renderer/src/components/ProjectSettingsView.tsx` (Android/iOS device pickers, switch label)
- Modify: `e2e/smoke.spec.ts`

**Interfaces:**
- Produces:
  - `PreviewTab.device?: { kind: 'android' | 'ios'; running: boolean; name: string | null; holder: string | null; startedByApp: boolean; canInput: boolean }` (rows with `agentId = 'device:android' | 'device:ios'`, `url: ''`, `title: ''`, `devServer: null`).
  - IPC `previewDevice(kind: 'android' | 'ios', action: 'start' | 'home' | 'back' | 'shutdown'): Promise<void>`, `deviceSupport(): Promise<DeviceSupport>` (shared type moved to `shared/types.ts`).
  - `targetLabel(t: PreviewTab, nameOf: (id: string) => string): string`, `deviceStatus(t: PreviewTab, nameOf): string`.

- [ ] **Step 1: Write the failing test** `src/renderer/src/preview/targets.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { deviceStatus, targetLabel } from './targets';

const nameOf = (id: string) => ({ a1: 'Pixel', a2: 'Byte' })[id] ?? 'Employee';
const dev = (over: object) => ({ agentId: 'device:android', url: '', title: '', devServer: null, device: { kind: 'android' as const, running: true, name: 'Medium_Phone', holder: 'a2', startedByApp: true, canInput: true, ...over } });

describe('preview targets', () => {
  it('labels browser tabs and devices', () => {
    expect(targetLabel({ agentId: 'a1', url: 'http://x/', title: '', devServer: null }, nameOf)).toBe('Pixel · browser');
    expect(targetLabel(dev({}), nameOf)).toBe('Android · Medium_Phone (Byte)');
    expect(targetLabel(dev({ kind: 'ios', name: 'iPhone 17', holder: null }), nameOf)).toBe('iOS · iPhone 17 (free)');
    expect(targetLabel(dev({ running: false, name: null, holder: null }), nameOf)).toBe('Android · not running');
  });
  it('describes a device and whether it can be used', () => {
    expect(deviceStatus(dev({}), nameOf)).toBe('Android · Medium_Phone · used by Byte');
    expect(deviceStatus(dev({ kind: 'ios', name: 'iPhone 17', holder: null, canInput: false }), nameOf)).toBe('iOS · iPhone 17 · free · view only (install idb to tap and type)');
    expect(deviceStatus(dev({ running: false }), nameOf)).toBe('Android · not running');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/renderer/src/preview/targets.test.ts`
Expected: FAIL — cannot resolve `./targets`.

- [ ] **Step 3: Implement**

`src/renderer/src/preview/targets.ts`:

```ts
import type { PreviewTab } from '../../../shared/types';

const KIND = { android: 'Android', ios: 'iOS' } as const;

export function targetLabel(t: PreviewTab, nameOf: (id: string) => string): string {
  if (!t.device) return `${nameOf(t.agentId)} · browser`;
  const d = t.device;
  if (!d.running) return `${KIND[d.kind]} · not running`;
  return `${KIND[d.kind]} · ${d.name ?? 'device'} (${d.holder ? nameOf(d.holder) : 'free'})`;
}

export function deviceStatus(t: PreviewTab, nameOf: (id: string) => string): string {
  const d = t.device!;
  if (!d.running) return `${KIND[d.kind]} · not running`;
  return `${KIND[d.kind]} · ${d.name ?? 'device'} · ${d.holder ? `used by ${nameOf(d.holder)}` : 'free'}${d.canInput ? '' : ' · view only (install idb to tap and type)'}`;
}
```

Main side (`projectService.ts`):

```ts
  async previewList(): Promise<PreviewTab[]> {
    const ws = this.mustWs();
    const support = await this.deviceSupportFor(ws);
    const devices = (await ws.devices.states()).filter((s) => s.running || support[s.kind].ok).map((s): PreviewTab => ({ agentId: `device:${s.kind}`, url: '', title: '', devServer: null, device: s }));
    return [...previewRows(await ws.browser.tabs(), ws.devServers.all()), ...devices];
  }
  async previewWatch(target: string | null): Promise<void> {
    const ws = this.mustWs();
    const kind = deviceKindOf(target);
    ws.devices.watch(kind);
    await ws.browser.watch(kind ? null : target);
  }
  previewAck(): void { this.ws?.browser.ack(); this.ws?.devices.ack(); }
  async previewInput(target: string, e: PreviewInput): Promise<void> {
    const ws = this.mustWs();
    const kind = deviceKindOf(target);
    if (kind) await ws.devices.input(kind, e); else await ws.browser.input(target, e);
  }
  async previewDevice(kind: DeviceKind, action: 'start' | 'home' | 'back' | 'shutdown'): Promise<void> {
    const ws = this.mustWs();
    if (action === 'start') return ws.devices.startByUser(kind);
    if (action === 'shutdown') return ws.devices.shutdownByUser(kind);
    await ws.devices.input(kind, { kind: 'key', key: action === 'home' ? 'Home' : 'Escape' });
  }
  async deviceSupport(): Promise<DeviceSupport> { return detectDevices(resolveDeviceTools(process.env, process.platform, this.d.deviceTools)); }
```

with `const deviceKindOf = (t: string | null): DeviceKind | null => (t === 'device:android' ? 'android' : t === 'device:ios' ? 'ios' : null);` and a 60-second cache for `deviceSupportFor(ws)` (store `{ at, value }` on the workspace). Add `'Home'` to `PREVIEW_KEYS` in `browser/previewArgs.ts` (so the device Home works through `previewInput`; the browser ignores it harmlessly as a page key). Move `DeviceSupport` to `shared/types.ts` (re-export from `devices/tools.ts`).

IPC: `previewDevice: 'preview:device'`, `deviceSupport: 'devices:support'`; preload; `index.ts`:

```ts
  handle(IPC.previewDevice, (kind: unknown, action: unknown) => {
    if (kind !== 'android' && kind !== 'ios') throw new Error('Unknown device');
    if (!['start', 'home', 'back', 'shutdown'].includes(String(action))) throw new Error('Unknown device action');
    return svc.previewDevice(kind, action as 'start' | 'home' | 'back' | 'shutdown');
  });
  handle(IPC.deviceSupport, () => svc.deviceSupport());
```

`PreviewView.tsx`:
- The picker label becomes "Show"; options use `targetLabel`.
- When the selected row has `device`: the status line uses `deviceStatus`; buttons are **Start** (when not running), **Home**, **Back** (Android only), **Shut down** (only when `startedByApp`), instead of Reload / Open in my browser / Stop dev server.
- `img.src = \`data:${f.mime ?? 'image/jpeg'};base64,${f.data}\``.
- The canvas `aria-label` for devices: `Live view of the ${KIND} device`.
- Input on a device with `canInput === false`: do nothing on click/keys (the status line says view only).
- The empty state shows only when there are no rows at all (devices that are available always produce a row, so a project with Android shows "Android · not running" with a Start button).

`AppSettingsView.tsx` — add a section after Claude Code:

```tsx
      <section className="panel-box" aria-labelledby="set-devices">
        <h2 id="set-devices" style={{ margin: 0, fontSize: 16 }}>Mobile devices</h2>
        {!support ? <p className="small muted">Checking…</p> : (
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            <li>Android: {support.android.ok ? `ready (${support.android.avds.join(', ')})` : support.android.reason}</li>
            <li>iOS: {support.ios.ok ? `ready (${support.ios.devices.map((d) => d.name).slice(0, 3).join(', ')})${support.ios.idb ? '' : ' · view only until idb is installed: brew install facebook/fb/idb-companion and pip3 install fb-idb'}` : support.ios.reason}</li>
          </ul>
        )}
      </section>
```

with `const [support, setSupport] = useState<DeviceSupport | null>(null); useEffect(() => { window.agentOffice.deviceSupport().then(setSupport, () => undefined); }, []);`. (`deviceSupport` needs an open project only for `previewList`; make `ProjectService.deviceSupport()` work without one — it does not use `mustWs`.)

`ProjectSettingsView.tsx`:
- The browser checkbox label becomes "Employees can use a browser and mobile devices to check their work".
- Two `<select>`s ("Android device", "iOS device") with "Automatic" (`''`) plus the AVD names / simulators from `deviceSupport()`; saved with `updateProject({ …, androidDevice, iosDevice })`. Hide a select when its platform is not available.

- [ ] **Step 4: e2e**

Add to `e2e/smoke.spec.ts`:

```ts
test('the Preview tab shows the Android emulator and taps it', async () => {
  const repo = await makeRepo();
  const devDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-fdev-'));
  const FT = path.resolve('test/fake-devices/fake-tool.mjs');
  const env = {
    AO_CLAUDE_BIN: process.execPath, AO_CLAUDE_ARGS: JSON.stringify([FAKE]), AO_E2E_PICK_FOLDER: repo,
    FAKE_DEVICE_DIR: devDir,
    AO_DEVICE_TOOLS: JSON.stringify({ adb: [process.execPath, FT, 'adb'], emulator: [process.execPath, FT, 'emulator'], platform: 'linux' }),
  };
  const { app, userData } = await launch(env);
  try {
    const win = await app.firstWindow();
    await win.getByRole('button', { name: 'Browse' }).click();
    await win.getByRole('button', { name: /Open the office/ }).click();
    await win.getByRole('navigation', { name: 'Project views' }).getByRole('button', { name: 'Preview' }).click();
    await expect(win.getByLabel('Show')).toContainText('Android · not running');
    await win.getByRole('button', { name: 'Start' }).click();
    await expect(win.getByLabel('Show')).toContainText('Android · Medium_Phone (free)', { timeout: 20_000 });
    const live = win.getByLabel(/Live view of the Android device/);
    await expect.poll(async () => Number(await live.getAttribute('data-frames')), { timeout: 20_000 }).toBeGreaterThan(0);
    await live.click({ position: { x: 20, y: 20 } });
    await expect.poll(async () => (await fs.readFile(path.join(devDir, 'calls.jsonl'), 'utf8')).includes('"tap"'), { timeout: 10_000 }).toBe(true);
    await win.getByRole('button', { name: 'Shut down' }).click();
    await expect(win.getByLabel('Show')).toContainText('Android · not running', { timeout: 20_000 });
  } finally {
    await app.close();
    await fs.rm(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    await fs.rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    await fs.rm(devDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
```

- [ ] **Step 5: Run every gate**

Run: `npm run typecheck && npm test && npm run test:e2e`
Expected: all pass (10 e2e). Screenshot the Preview tab with the fake Android device and App Settings' Mobile devices section.

- [ ] **Step 6: Commit**

```bash
git add src e2e
git commit -m "feat(ui): devices in the Preview tab, and mobile device settings"
```

---

### Task 7: Docs, CI and a manual check on real devices

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: AGENTS.md**

- Architecture: add `devices/         DeviceService (one emulator and one simulator per project, holds, live view), AndroidDriver / IosDriver (adb, emulator, simctl, idb), deviceTools (office MCP tools), parse, tools (find and run the platform tools)`.
- Security rules: "Device tools take only enums, refs, short text and paths inside the caller's worktree (realpath-checked); commands are argv arrays with timeouts and output caps. One employee holds a device at a time; the app shuts down only devices it started."
- Testing conventions: "`test/fake-devices/fake-tool.mjs` stands in for adb, emulator, xcrun and idb (state in `FAKE_DEVICE_DIR`, calls in `calls.jsonl`); `test/helpers/fakeDevices.ts` wires it. Dev hook `AO_DEVICE_TOOLS` (unpackaged only) points the app at the fakes."
- Known gaps: "Device live view is screenshot polling (~3 fps). iOS input needs idb. Real devices and phones are not supported. Large device screenshots are not downscaled before reaching the model."

- [ ] **Step 2: Manual check (this Mac, real tools)**

With the built app's main-process code, from a scratch script (not committed) that constructs `DeviceService` with `resolveDeviceTools(process.env)`:
1. `use('a1', 'android')` → `Medium_Phone` boots (up to 3 minutes); `snapshot()`, `screenshot()`, `tap()` at a ref; `close()` shuts it down.
2. `use('a1', 'ios')` → an iPhone boots; `screenshot()` works; `tap()` reports the idb hint (idb is not installed); `close()` shuts it down.
Record the results in the final report.

- [ ] **Step 3: Gates and commit**

Run: `npm run typecheck && npm test && npm run test:e2e`
Expected: PASS.

```bash
git add AGENTS.md
git commit -m "docs: mobile devices"
```
