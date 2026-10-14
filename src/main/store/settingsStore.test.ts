import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_SETTINGS, SettingsStore } from './settingsStore';

let dir: string;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-set-')); });
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); });

describe('SettingsStore', () => {
  it('returns defaults, then merges and persists patches', async () => {
    const s = new SettingsStore(path.join(dir, 'settings.json'));
    expect(await s.get()).toEqual(DEFAULT_SETTINGS);
    expect(await s.save({ claudePath: '/opt/claude' })).toEqual({ ...DEFAULT_SETTINGS, claudePath: '/opt/claude' });
    expect(await new SettingsStore(path.join(dir, 'settings.json')).get()).toMatchObject({ claudePath: '/opt/claude', isolateUserSettings: true });
  });

  it('rejects invalid patches', async () => {
    const s = new SettingsStore(path.join(dir, 'settings.json'));
    await expect(s.save({ isolateUserSettings: 'no' } as never)).rejects.toThrow();
  });
});
