import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { finished, harness, STUB_PICK, type Harness } from './helpers/manager';
import type { ModelPick } from '../src/shared/types';

let h: Harness;
beforeEach(async () => { h = await harness(); });
afterEach(async () => { await h.cleanup(); });

const modelArg = (argv: string[]) => argv[argv.indexOf('--model') + 1];
function deferred() {
  let release!: (p: ModelPick) => void;
  const promise = new Promise<ModelPick>((r) => { release = r; });
  return { promise, release };
}
const HAIKU: ModelPick = { model: 'haiku', size: 'small', reason: 'one line', source: 'classifier' };

/** Tests here must not depend on what the seeded roles default to. */
async function make(opts: Parameters<Harness['make']>[0]) {
  const env = await h.make(opts);
  const fe = (await env.roles.get('frontend'))!;
  await env.roles.save({ ...fe, model: 'auto' });
  return env;
}

describe('model per task', () => {
  it('waits for the classifier, then runs on the picked model', async () => {
    const d = deferred();
    const classify = vi.fn(() => d.promise);
    const { manager } = await make({ classify });
    await manager.hire('frontend');
    const t = await manager.createTask({ assignee: 'Pixel', title: 'Fix typo', brief: 'teh → the', createdBy: 'boss' });
    expect(t.status).toBe('queued');
    await manager.idle();
    expect(manager.getTask(t.id)!.model).toBeUndefined();
    expect(await h.launches()).toHaveLength(0);
    await vi.waitFor(() => expect(classify).toHaveBeenCalledWith({ title: 'Fix typo', brief: 'teh → the', roleName: 'Frontend Engineer' }, expect.any(AbortSignal)));

    const done = finished(manager, t.id);
    d.release(HAIKU);
    await done;
    expect(modelArg((await h.launches())[0].argv)).toBe('haiku');
    expect(manager.getTask(t.id)).toMatchObject({ model: 'haiku', modelPick: HAIKU });
  });

  it('a pinned role skips the classifier', async () => {
    const classify = vi.fn(async () => HAIKU);
    const { manager, roles } = await h.make({ classify });
    const fe = (await roles.get('frontend'))!;
    await roles.save({ ...fe, model: 'opus' });
    await manager.hire('frontend');
    const t = await manager.createTask({ assignee: 'Pixel', title: 'a', brief: 'a', createdBy: 'boss' });
    await finished(manager, t.id);
    expect(classify).not.toHaveBeenCalled();
    expect(modelArg((await h.launches())[0].argv)).toBe('opus');
    expect(manager.getTask(t.id)!.modelPick).toEqual({ model: 'opus', reason: 'Pinned by role', source: 'role' });
  });

  it('follow-up feedback keeps the task model', async () => {
    const { manager } = await make({ classify: async () => HAIKU });
    await manager.hire('frontend');
    const t = await manager.createTask({ assignee: 'Pixel', title: 'a', brief: 'a', createdBy: 'boss' });
    await finished(manager, t.id);
    await manager.idle();
    const again = finished(manager, t.id);
    await manager.messageAgent('Pixel', 'also dark mode');
    await again;
    const last = (await h.launches()).at(-1)!.argv;
    expect(last).toContain('--resume');
    expect(modelArg(last)).toBe('haiku');
  });

  it('a plain question to an auto role uses sonnet, never auto', async () => {
    const { manager } = await make({ classify: async () => HAIKU });
    await manager.hire('frontend');
    const t = await manager.createTask({ assignee: 'Pixel', title: 'a', brief: 'a', createdBy: 'boss' });
    await finished(manager, t.id);
    await manager.merge(t.id);
    await manager.idle();
    await manager.messageAgent('Pixel', 'what did you learn?');
    await manager.idle();
    await vi.waitFor(async () => expect((await h.launches()).length).toBe(2), { timeout: 15_000 });
    expect(modelArg((await h.launches())[1].argv)).toBe('sonnet');
  });

  it('drops a result that arrives after shutdown and re-classifies on the next load', async () => {
    // Like a real classifier that answers as it is being cancelled: the answer must still be dropped.
    const lateAnswer = vi.fn((_i: unknown, signal?: AbortSignal) => new Promise<ModelPick>((r) => signal?.addEventListener('abort', () => r(HAIKU))));
    const first = await make({ classify: lateAnswer });
    await first.manager.hire('frontend');
    const t = await first.manager.createTask({ assignee: 'Pixel', title: 'a', brief: 'a', createdBy: 'boss' });
    await vi.waitFor(() => expect(lateAnswer).toHaveBeenCalled());
    await first.manager.shutdown();
    await first.manager.idle();
    expect((await first.store.getTasks('p1'))[0].model).toBeUndefined();

    const second = await h.make({ classify: async () => STUB_PICK });
    await finished(second.manager, t.id);
    expect(modelArg((await h.launches())[0].argv)).toBe('sonnet');
  });
  it('a pre-upgrade task reopened by feedback, then paused and resumed, still runs', async () => {
    const first = await make({});
    const pixel = await first.manager.hire('frontend');
    await first.manager.shutdown();
    const now = new Date().toISOString();
    await first.store.saveTasks('p1', [{ id: 'T-101', projectId: 'p1', title: 'old', brief: 'old work', assigneeId: pixel.id, createdBy: 'boss', status: 'review', held: false, attempts: 1, branch: 'ao/pixel/old-t-101', dependsOn: [], createdAt: now, updatedAt: now }]);

    const { manager } = await h.make();
    h.fakeEnv.FAKE_CLAUDE_HANG = '1';
    await manager.messageAgent('Pixel', 'one more thing');
    delete h.fakeEnv.FAKE_CLAUDE_HANG;
    await manager.pauseTask('T-101');
    await vi.waitFor(() => expect(manager.agents().find((a) => a.name === 'Pixel')!.status).toBe('paused'), { timeout: 15_000 });
    const done = finished(manager, 'T-101');
    await manager.resumeTask('T-101');
    await done;
    expect(manager.getTask('T-101')).toMatchObject({ status: 'review', model: 'sonnet' });
  });
  it('shutdown cancels an in-flight classification and waits for it', async () => {
    let seen: AbortSignal | undefined;
    let settled = false;
    const classify = vi.fn((_i: unknown, signal?: AbortSignal) => new Promise<ModelPick>((resolve) => {
      seen = signal;
      signal?.addEventListener('abort', () => setTimeout(() => { settled = true; resolve(STUB_PICK); }, 50));
    }));
    const { manager } = await make({ classify });
    await manager.hire('frontend');
    await manager.createTask({ assignee: 'Pixel', title: 'a', brief: 'a', createdBy: 'boss' });
    await vi.waitFor(() => expect(classify).toHaveBeenCalled());
    await manager.shutdown();
    expect(seen?.aborted).toBe(true);
    expect(settled).toBe(true);
  });
});
