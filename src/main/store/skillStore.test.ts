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
  it('reads tags from the frontmatter, and gives [] without them', () => {
    expect(parseSkill('a', '---\nname: A\ndescription: d\ntags: Go, backend\n---\n- x').tags).toEqual(['go', 'backend']);
    expect(parseSkill('b', '---\nname: B\ndescription: d\n---\n- x').tags).toEqual([]);
    expect(parseSkill('c', 'no frontmatter').tags).toEqual([]);
  });
});

describe('SkillStore.save', () => {
  let dir: string;
  beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-skill-')); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); });

  it('writes tags back so a saved skill keeps them', async () => {
    const store = new SkillStore(dir);
    await store.save({ id: 'go-services', name: 'Go', description: 'd', body: '- x', tags: ['go', 'backend'] });
    expect((await store.get('go-services'))!.tags).toEqual(['go', 'backend']);
    await store.save({ id: 'plain', name: 'P', description: 'd', body: '- x', tags: [] });
    expect(await fs.readFile(path.join(dir, 'plain.md'), 'utf8')).not.toContain('tags:');
  });
});
