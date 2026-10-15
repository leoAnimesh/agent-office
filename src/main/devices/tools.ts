import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import spawn from 'cross-spawn';
import { killTree } from '../claude/killTree';
import type { DeviceSupport } from '../../shared/types';
import { parseAvds, parseSimulators } from './parse';

export interface ToolCmd { bin: string; pre: string[] }
export interface DeviceTools { platform: NodeJS.Platform; adb?: ToolCmd; emulator?: ToolCmd; xcrun?: ToolCmd; idb?: ToolCmd }
export interface DeviceToolsOverride { adb?: string[]; emulator?: string[]; xcrun?: string[]; idb?: string[]; platform?: string }
export interface RunResult { code: number | null; stdout: Buffer; stderr: string }
export type { DeviceSupport };

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
