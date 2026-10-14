import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SkillStore, parseSkill } from './skillStore';

describe('parseSkill', () => {
  it('reads front-matter and body, with CRLF line endings too', () => {
    const s = parseSkill('x', '---\r\nname: X skill\r\ndescription: Does x\r\n---\r\nBody line\r\n');
    expect(s).toEqual({ id: 'x', name: 'X skill', description: 'Does x', body: 'Body line' });
  });

  it('falls back to the id when there is no front-matter', () => {
    expect(parseSkill('plain', 'Just text')).toEqual({ id: 'plain', name: 'plain', description: '', body: 'Just text' });
  });
});

describe('SkillStore', () => {
  let dir: string;
  beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-skills-')); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('seeds built-ins and fetches several, skipping missing ids', async () => {
    const store = new SkillStore(dir);
    expect(await store.seed(path.resolve('resources/skills'))).toBe(6);
    const got = await store.getMany(['react-patterns', 'does-not-exist', 'git-hygiene']);
    expect(got.map((s) => s.id)).toEqual(['react-patterns', 'git-hygiene']);
    expect(got[0].name).toBe('React patterns');
  });
});
