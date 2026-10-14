import { statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crossSpawn from 'cross-spawn';

export interface LocateEnv {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  home: string;
  isFile(p: string): boolean;
}

export function candidatePaths(e: LocateEnv): string[] {
  const win = e.platform === 'win32';
  const p = win ? path.win32 : path.posix;
  const pathVar = (win ? e.env.Path ?? e.env.PATH : e.env.PATH) ?? '';
  const dirs = pathVar.split(win ? ';' : ':').filter(Boolean);
  const exts = win ? (e.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map((x) => x.toLowerCase()) : [''];
  const fromPath = dirs.flatMap((d) => exts.map((x) => p.join(d, `claude${x}`)));
  const known = win
    ? [
        e.env.APPDATA ? p.join(e.env.APPDATA, 'npm', 'claude.cmd') : null,
        e.env.LOCALAPPDATA ? p.join(e.env.LOCALAPPDATA, 'Programs', 'claude', 'claude.exe') : null,
        p.join(e.home, '.local', 'bin', 'claude.exe'),
      ]
    : [
        p.join(e.home, '.local', 'bin', 'claude'),
        p.join(e.home, '.claude', 'local', 'claude'),
        '/opt/homebrew/bin/claude',
        '/usr/local/bin/claude',
      ];
  return [...new Set([...fromPath, ...known.filter((x): x is string => x !== null)])];
}

export function locateClaude(e: LocateEnv, override?: string): string | null {
  if (override) return e.isFile(override) ? override : null;
  return candidatePaths(e).find((c) => e.isFile(c)) ?? null;
}

export function parseVersion(out: string): string | null {
  return /(\d+\.\d+\.\d+)/.exec(out)?.[1] ?? null;
}

export function claudeVersion(bin: string): string | null {
  const r = crossSpawn.sync(bin, ['--version'], { encoding: 'utf8', timeout: 15000, windowsHide: true });
  if (r.status !== 0 || typeof r.stdout !== 'string') return null;
  return parseVersion(r.stdout);
}

export function systemLocateEnv(): LocateEnv {
  return {
    platform: process.platform,
    env: process.env,
    home: os.homedir(),
    isFile: (p) => {
      try { return statSync(p).isFile(); } catch { return false; }
    },
  };
}
