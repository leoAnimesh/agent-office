import { describe, expect, it } from 'vitest';
import { candidatePaths, locateClaude, parseVersion, type LocateEnv } from './locate';

const posix = (files: string[], PATH = '/usr/bin:/home/u/.local/bin'): LocateEnv => ({
  platform: 'darwin', env: { PATH }, home: '/home/u', isFile: (p) => files.includes(p),
});

describe('locateClaude', () => {
  it('finds claude on PATH first (POSIX)', () => {
    expect(locateClaude(posix(['/home/u/.local/bin/claude', '/opt/homebrew/bin/claude']))).toBe('/home/u/.local/bin/claude');
  });

  it('falls back to known install locations when PATH is minimal (GUI launch)', () => {
    expect(locateClaude(posix(['/home/u/.claude/local/claude'], '/usr/bin:/bin'))).toBe('/home/u/.claude/local/claude');
  });

  it('honours PATHEXT on Windows and finds the npm .cmd shim', () => {
    const e: LocateEnv = {
      platform: 'win32',
      env: { Path: 'C:\\Windows;C:\\Users\\u\\AppData\\Roaming\\npm', PATHEXT: '.COM;.EXE;.CMD', APPDATA: 'C:\\Users\\u\\AppData\\Roaming' },
      home: 'C:\\Users\\u',
      isFile: (p) => p === 'C:\\Users\\u\\AppData\\Roaming\\npm\\claude.cmd',
    };
    expect(candidatePaths(e)).toContain('C:\\Users\\u\\AppData\\Roaming\\npm\\claude.cmd');
    expect(locateClaude(e)).toBe('C:\\Users\\u\\AppData\\Roaming\\npm\\claude.cmd');
  });

  it('uses an override only if it exists', () => {
    expect(locateClaude(posix(['/x/claude']), '/x/claude')).toBe('/x/claude');
    expect(locateClaude(posix(['/home/u/.local/bin/claude']), '/missing/claude')).toBeNull();
  });

  it('returns null when nothing is installed', () => {
    expect(locateClaude(posix([]))).toBeNull();
  });
});

describe('parseVersion', () => {
  it('extracts the semver from `claude --version` output', () => {
    expect(parseVersion('2.1.299 (Claude Code)\n')).toBe('2.1.299');
    expect(parseVersion('garbage')).toBeNull();
  });
});
