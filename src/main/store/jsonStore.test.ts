import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendJsonl, copyMissingFiles, readJson, readJsonl, writeJsonAtomic } from './jsonStore';

let dir: string;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-json-')); });
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

describe('jsonStore', () => {
  it('returns the fallback when the file does not exist', async () => {
    expect(await readJson(path.join(dir, 'missing.json'), { a: 1 })).toEqual({ a: 1 });
  });

  it('writes atomically into nested folders and reads back', async () => {
    const file = path.join(dir, 'a', 'b', 'data.json');
    await writeJsonAtomic(file, { hello: 'world' });
    expect(await readJson(file, null)).toEqual({ hello: 'world' });
    const leftovers = (await fs.readdir(path.dirname(file))).filter((f) => f.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('names the file when JSON is corrupt', async () => {
    const file = path.join(dir, 'bad.json');
    await fs.writeFile(file, '{ nope');
    await expect(readJson(file, null)).rejects.toThrow(/Corrupt JSON in .*bad\.json/);
  });

  it('survives many concurrent writes to the same file', async () => {
    const file = path.join(dir, 'race.json');
    await Promise.all(Array.from({ length: 20 }, (_, i) => writeJsonAtomic(file, { i })));
    const v = await readJson<{ i: number }>(file, { i: -1 });
    expect(v.i).toBeGreaterThanOrEqual(0);
  });

  it('appends and reads JSON lines, keeping the last N', async () => {
    const file = path.join(dir, 'log.jsonl');
    for (let i = 0; i < 5; i++) await appendJsonl(file, { i });
    expect(await readJsonl(file, 2)).toEqual([{ i: 3 }, { i: 4 }]);
    expect(await readJsonl(path.join(dir, 'none.jsonl'), 10)).toEqual([]);
  });

  it('copies only files missing in the target', async () => {
    const from = path.join(dir, 'from');
    const to = path.join(dir, 'to');
    await fs.mkdir(from);
    await fs.mkdir(to);
    await fs.writeFile(path.join(from, 'a.json'), 'new-a');
    await fs.writeFile(path.join(from, 'b.json'), 'new-b');
    await fs.writeFile(path.join(to, 'a.json'), 'user-edited');
    expect(await copyMissingFiles(from, to)).toBe(1);
    expect(await fs.readFile(path.join(to, 'a.json'), 'utf8')).toBe('user-edited');
    expect(await fs.readFile(path.join(to, 'b.json'), 'utf8')).toBe('new-b');
  });
});
