import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Skill } from '../../shared/types';
import { copyMissingFiles } from './jsonStore';

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** `tags:` frontmatter: a hint for the boss when it picks project skills. */
export function parseTags(raw: string): string[] {
  return raw.split(',').map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0 && t.length <= 30).slice(0, 10);
}

export function parseSkill(id: string, raw: string): Skill {
  const text = raw.replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!m) return { id, name: id, description: '', body: text.trim(), tags: [] };
  const meta: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { id, name: meta.name || id, description: meta.description ?? '', body: m[2].trim(), tags: parseTags(meta.tags ?? '') };
}

export class SkillStore {
  constructor(private readonly dir: string) {}

  async list(): Promise<Skill[]> {
    let files: string[];
    try {
      files = (await fs.readdir(this.dir)).filter((f) => f.endsWith('.md'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const skills = await Promise.all(files.map((f) => this.get(f.slice(0, -3))));
    return skills.filter((s): s is Skill => s !== null).sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(id: string): Promise<Skill | null> {
    if (!ID.test(id)) return null;
    try {
      return parseSkill(id, await fs.readFile(path.join(this.dir, `${id}.md`), 'utf8'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async getMany(ids: string[]): Promise<Skill[]> {
    const got = await Promise.all(ids.map((id) => this.get(id)));
    return got.filter((s): s is Skill => s !== null);
  }

  async save(skill: Skill): Promise<void> {
    if (!ID.test(skill.id)) throw new Error(`Invalid skill id: ${skill.id}`);
    await fs.mkdir(this.dir, { recursive: true });
    const tags = skill.tags.length > 0 ? `tags: ${skill.tags.join(', ')}\n` : '';
    await fs.writeFile(path.join(this.dir, `${skill.id}.md`), `---\nname: ${skill.name.replace(/\n/g, ' ')}\ndescription: ${skill.description.replace(/\n/g, ' ')}\n${tags}---\n${skill.body.trim()}\n`);
  }

  seed(fromDir: string): Promise<number> {
    return copyMissingFiles(fromDir, this.dir);
  }
}
