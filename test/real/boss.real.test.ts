import { describe, expect, it } from 'vitest';
import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getAppStatus } from '../../src/main/appStatus';
import { dataPaths } from '../../src/main/store/paths';
import { RoleStore } from '../../src/main/store/roleStore';
import { ProjectService, projectIdFor } from '../../src/main/workspace/projectService';
import { makeRepo } from '../helpers/repo';

// Spends real Claude usage. Run with: AO_REAL_CLAUDE=1 npx vitest run test/real
describe.skipIf(!process.env.AO_REAL_CLAUDE)('real Claude Code end-to-end', () => {
  it('the boss hires, delegates and merges a tiny change', async () => {
    const bin = getAppStatus().claude?.path;
    if (!bin) throw new Error('claude not found');
    const repo = await makeRepo();
    const data = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-real-'));
    const paths = dataPaths(data);
    const svc = new ProjectService({ paths, resourcesDir: path.resolve('resources'), claudeBin: bin, isolateUserSettings: true });
    await svc.init();
    const roles = new RoleStore(paths.rolesDir);
    await roles.save({ ...(await roles.get('boss'))!, model: 'sonnet' });
    await roles.save({ ...(await roles.get('frontend'))!, model: 'haiku' });
    const id = projectIdFor(repo);
    await fs.mkdir(paths.projectDir(id), { recursive: true });
    await fs.writeFile(paths.projectFile(id), JSON.stringify({ id, name: 'real', repoPath: repo, baseBranch: 'main', maxConcurrent: 2, bossCanHire: true, autoMerge: true }));
    const log: string[] = [];
    svc.on('event', (e) => { if (e.type === 'chat') log.push(`${e.entry.kind}: ${'text' in e.entry ? e.entry.text : e.entry.tool}`); });
    try {
      await svc.open(repo);
      await svc.sendToBoss('Hire one Frontend Engineer and ask them to create a file named hello.txt containing exactly the word hi, and commit it. When they finish, merge it. Keep everything short.');
      const deadline = Date.now() + 8 * 60_000;
      while (!existsSync(path.join(repo, 'hello.txt')) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 2000));
      console.log(log.join('\n'));
      expect((await fs.readFile(path.join(repo, 'hello.txt'), 'utf8')).trim()).toBe('hi');
    } finally {
      await svc.close();
      await fs.rm(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      await fs.rm(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }, 10 * 60_000);
});
