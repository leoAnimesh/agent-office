import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RoleStore } from './roleStore';
import { SettingsStore } from './settingsStore';
import { migrateRolesToAuto } from './migrations';

let dir: string;
let roles: RoleStore;
let settings: SettingsStore;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-mig-'));
  roles = new RoleStore(path.join(dir, 'roles'));
  settings = new SettingsStore(path.join(dir, 'settings.json'));
  await roles.seed(path.resolve('resources/roles'));
});
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); });

describe('migrateRolesToAuto', () => {
  it('moves every employee role (built-in or custom) to auto, never the boss, and only once', async () => {
    const fe = (await roles.get('frontend'))!;
    await roles.save({ ...fe, model: 'sonnet' });
    await roles.save({ ...fe, id: 'custom', name: 'Custom', model: 'haiku' });
    await roles.save({ ...(await roles.get('boss'))!, model: 'sonnet' });

    await migrateRolesToAuto(roles, settings);
    const all = await roles.list();
    expect(all.filter((r) => r.id !== 'boss').every((r) => r.model === 'auto')).toBe(true);
    expect((await roles.get('boss'))!.model).toBe('sonnet');
    expect((await settings.get()).autoModelMigrated).toBe(true);

    await roles.save({ ...(await roles.get('custom'))!, model: 'opus' });
    expect(await migrateRolesToAuto(roles, settings)).toBe(0);
    expect((await roles.get('custom'))!.model).toBe('opus');
  });
});
