import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RoleStore } from './roleStore';
import { SettingsStore } from './settingsStore';
import { migrateRolesAllTools, migrateRolesToAuto } from './migrations';
import { ALL_TOOLS } from '../../shared/tools';

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

describe('migrateRolesAllTools', () => {
  it('gives every employee role every tool, keeps extras, leaves the boss, and runs once', async () => {
    const fe = (await roles.get('frontend'))!;
    await roles.save({ ...fe, id: 'custom', name: 'Custom', allowedTools: ['Read', 'mcp__docs'] });
    await migrateRolesAllTools(roles, settings);
    for (const r of await roles.list()) {
      if (r.id === 'boss') expect(r.allowedTools).toEqual(['Read', 'Grep', 'Glob']);
      else expect(r.allowedTools).toEqual(expect.arrayContaining(ALL_TOOLS));
    }
    expect((await roles.get('custom'))!.allowedTools).toContain('mcp__docs');
    expect((await settings.get()).allToolsMigrated).toBe(true);

    await roles.save({ ...(await roles.get('custom'))!, allowedTools: ['Read'] });
    expect(await migrateRolesAllTools(roles, settings)).toBe(0);
    expect((await roles.get('custom'))!.allowedTools).toEqual(['Read']);
  });
});

describe('built-in roles', () => {
  it('ship every employee role with every tool', async () => {
    for (const r of await roles.list()) if (r.id !== 'boss') expect(r.allowedTools).toEqual(ALL_TOOLS);
  });
});
