import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** Commits the fixture dev server as server.mjs so employee worktrees have it. */
export async function addFixtureServer(repo: string): Promise<void> {
  await fs.copyFile(path.resolve('test/fixtures/dev-server.mjs'), path.join(repo, 'server.mjs'));
  execFileSync('git', ['add', 'server.mjs'], { cwd: repo });
  execFileSync('git', ['commit', '-q', '-m', 'add server'], { cwd: repo });
}
