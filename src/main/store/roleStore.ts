import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Role } from '../../shared/types';
import { copyMissingFiles, readJson, writeJsonAtomic } from './jsonStore';

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export class RoleStore {
  constructor(private readonly dir: string) {}

  async list(): Promise<Role[]> {
    let files: string[];
    try {
      files = (await fs.readdir(this.dir)).filter((f) => f.endsWith('.json'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const roles = await Promise.all(files.map((f) => readJson<Role | null>(path.join(this.dir, f), null)));
    return roles.filter((r): r is Role => r !== null).sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(id: string): Promise<Role | null> {
    if (!ID.test(id)) return null;
    return readJson<Role | null>(path.join(this.dir, `${id}.json`), null);
  }

  async save(role: Role): Promise<void> {
    if (!ID.test(role.id)) throw new Error(`Invalid role id: ${role.id}`);
    await writeJsonAtomic(path.join(this.dir, `${role.id}.json`), role);
  }

  seed(fromDir: string): Promise<number> {
    return copyMissingFiles(fromDir, this.dir);
  }
}
