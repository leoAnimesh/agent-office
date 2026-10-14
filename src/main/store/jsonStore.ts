import { promises as fs } from 'node:fs';
import path from 'node:path';

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw err;
  }
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new Error(`Corrupt JSON in ${file}: ${(err as Error).message}`);
  }
}

let counter = 0;

export async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${counter++}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  try {
    await renameWithRetry(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

/** Windows refuses to replace a file another handle is touching (EPERM/EBUSY); retry briefly. */
async function renameWithRetry(from: string, to: string, attempts = 8): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (i >= attempts || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw err;
      await new Promise((r) => setTimeout(r, 20 * i));
    }
  }
}

export async function appendJsonl(file: string, obj: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, JSON.stringify(obj) + '\n', 'utf8');
}

export async function readJsonl(file: string, limit: number): Promise<unknown[]> {
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const out: unknown[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip a torn last line */ }
  }
  return out.slice(-limit);
}

export async function copyMissingFiles(fromDir: string, toDir: string): Promise<number> {
  await fs.mkdir(toDir, { recursive: true });
  let copied = 0;
  for (const name of await fs.readdir(fromDir)) {
    const target = path.join(toDir, name);
    try {
      await fs.copyFile(path.join(fromDir, name), target, fs.constants.COPYFILE_EXCL);
      copied++;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
  return copied;
}
