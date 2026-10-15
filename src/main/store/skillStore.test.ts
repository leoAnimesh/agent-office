import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SkillStore, parseSkill, parseTags } from './skillStore';

describe('parseTags', () => {
  it('trims, lower-cases, drops empties and caps count and length', () => {
    expect(parseTags(' Frontend, React ,, CSS ')).toEqual(['frontend', 'react', 'css']);
    expect(parseTags('')).toEqual([]);
    expect(parseTags(Array.from({ length: 14 }, (_, i) => `t${i}`).join(','))).toHaveLength(10);
    expect(parseTags(`${'x'.repeat(40)}, ok`)).toEqual(['ok']);
  });
});

describe('parseSkill', () => {
  it('reads front-matter and body, with CRLF line endings too', () => {
    const s = parseSkill('x', '---\r\nname: X skill\r\ndescription: Does x\r\ntags: A\r\n---\r\nBody line\r\n');
    expect(s).toEqual({ id: 'x', name: 'X skill', description: 'Does x', body: 'Body line', tags: ['a'] });
  });

  it('falls back to the id when there is no front-matter', () => {
    expect(parseSkill('plain', 'Just text')).toEqual({ id: 'plain', name: 'plain', description: '', body: 'Just text', tags: [] });
  });

  it('reads tags from the frontmatter, and gives [] without them', () => {
    expect(parseSkill('a', '---\nname: A\ndescription: d\ntags: Go, backend\n---\n- x').tags).toEqual(['go', 'backend']);
    expect(parseSkill('b', '---\nname: B\ndescription: d\n---\n- x').tags).toEqual([]);
    expect(parseSkill('c', 'no frontmatter').tags).toEqual([]);
  });
});

describe('SkillStore', () => {
  let dir: string;
  beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-skill-')); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); });

  it('seeds built-ins and fetches several, skipping missing ids', async () => {
    const store = new SkillStore(dir);
    expect(await store.seed(path.resolve('resources/skills'))).toBe(22);
    const got = await store.getMany(['react-patterns', 'does-not-exist', 'git-hygiene']);
    expect(got.map((s) => s.id)).toEqual(['react-patterns', 'git-hygiene']);
    expect(got[0].name).toBe('React patterns');
  });

  it('adds tags to an older copy of a built-in skill, keeping its text', async () => {
    await fs.writeFile(path.join(dir, 'git-hygiene.md'), '---\nname: Git hygiene\ndescription: Commits and branches\n---\n- My own rule\n');
    await fs.writeFile(path.join(dir, 'mine.md'), '---\nname: Mine\ndescription: d\n---\n- x\n');
    const store = new SkillStore(dir);
    await store.seed(path.resolve('resources/skills'));
    expect(await store.get('git-hygiene')).toMatchObject({ tags: ['git'], body: '- My own rule' });
    expect((await store.get('mine'))!.tags).toEqual([]);
    expect((await store.get('docker'))!.tags).toEqual(['ops', 'docker']);
  });

  it('writes tags back so a saved skill keeps them', async () => {
    const store = new SkillStore(dir);
    await store.save({ id: 'go-services', name: 'Go', description: 'd', body: '- x', tags: ['go', 'backend'] });
    expect((await store.get('go-services'))!.tags).toEqual(['go', 'backend']);
    await store.save({ id: 'plain', name: 'P', description: 'd', body: '- x', tags: [] });
    expect(await fs.readFile(path.join(dir, 'plain.md'), 'utf8')).not.toContain('tags:');
  });
});
