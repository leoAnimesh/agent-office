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
    await vi.waitFor(() => expect(classify).toHaveBeenCalledWith({ title: 'Fix typo', brief: 'teh → the', roleName: 'Frontend Engineer' }));

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
    await vi.waitFor(async () => expect((await h.launches()).length).toBe(2));
    expect(modelArg((await h.launches())[1].argv)).toBe('sonnet');
  });

  it('drops a result that arrives after shutdown and re-classifies on the next load', async () => {
    const d = deferred();
    const first = await make({ classify: () => d.promise });
    await first.manager.hire('frontend');
    const t = await first.manager.createTask({ assignee: 'Pixel', title: 'a', brief: 'a', createdBy: 'boss' });
    await first.manager.shutdown();
    d.release(HAIKU);
    await new Promise((r) => setTimeout(r, 100));   // let the late result reach run()
    await first.manager.idle();
    expect((await first.store.getTasks('p1'))[0].model).toBeUndefined();

    const second = await h.make({ classify: async () => STUB_PICK });
    await finished(second.manager, t.id);
    expect(modelArg((await h.launches())[0].argv)).toBe('sonnet');
  });
});
