import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RoleStore } from './roleStore';

let dir: string;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-roles-')); });
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

describe('RoleStore', () => {
  it('seeds the built-in roles and lists them sorted by name', async () => {
    const store = new RoleStore(dir);
    expect(await store.seed(path.resolve('resources/roles'))).toBe(8);
    const roles = await store.list();
    expect(roles.map((r) => r.id)).toContain('frontend');
    expect(roles.map((r) => r.name)).toEqual([...roles.map((r) => r.name)].sort());
    for (const r of roles) {
      expect(r.allowedTools.length).toBeGreaterThan(0);
      expect(r.look.shirt).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('keeps user edits when seeding again', async () => {
    const store = new RoleStore(dir);
    await store.seed(path.resolve('resources/roles'));
    const fe = (await store.get('frontend'))!;
    await store.save({ ...fe, model: 'opus' });
    expect(await store.seed(path.resolve('resources/roles'))).toBe(0);
    expect((await store.get('frontend'))!.model).toBe('opus');
  });

  it('rejects unsafe role ids', async () => {
    const store = new RoleStore(dir);
    const fe = { id: '../evil', name: 'x', blurb: '', systemPrompt: '', skills: [], model: 'sonnet', permissionMode: 'default' as const, allowedTools: ['Read'], look: { hair: '#000000', shirt: '#000000', skin: '#000000' } };
    await expect(store.save(fe)).rejects.toThrow(/Invalid role id/);
  });

  it('returns null for an unknown role', async () => {
    expect(await new RoleStore(dir).get('nope')).toBeNull();
  });
});
