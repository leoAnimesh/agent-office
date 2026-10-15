import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bossTools, type ToolDef } from '../src/main/agents/bossTools';
import { finished, harness, type Harness } from './helpers/manager';

let h: Harness;
beforeEach(async () => { h = await harness(); });
afterEach(async () => { await h.cleanup(); });

const call = (tools: ToolDef[], name: string, args: unknown = {}) => tools.find((t) => t.name === name)!.run(args);

async function setup(over: { bossCanHire?: boolean } = {}) {
  const env = await h.make();
  const project = { ...env.project, ...over };
  const requestMerge = vi.fn(async () => ({ status: 'awaiting_user_approval' }));
  const report = vi.fn();
  const tools = bossTools({ manager: env.manager, roles: env.roles, project, requestMerge, report });
  return { ...env, tools, requestMerge, report };
}

describe('bossTools', () => {
  it('exposes the documented tool set', async () => {
    const { tools } = await setup();
    expect(tools.map((t) => t.name).sort()).toEqual(['assign_task', 'cancel_task', 'get_task', 'hire', 'list_roles', 'list_tasks', 'list_team', 'message_agent', 'report_to_user', 'request_merge', 'sync_branch']);
    for (const t of tools) expect(t.description.length).toBeGreaterThan(10);
  });

  it('lists roles without the boss role', async () => {
    const { tools } = await setup();
    const roles = (await call(tools, 'list_roles')) as { id: string }[];
    expect(roles.map((r) => r.id)).toContain('frontend');
    expect(roles.map((r) => r.id)).not.toContain('boss');
  });

  it('hires, lists the team, assigns, and reads back a finished task', async () => {
    const { tools, manager } = await setup();
    expect(await call(tools, 'hire', { role_id: 'frontend' })).toEqual({ name: 'Pixel', role: 'Frontend Engineer' });
    expect(await call(tools, 'list_team')).toEqual([{ name: 'Pixel', role: 'Frontend Engineer', status: 'idle', doing: 'Idle', current_task: null }]);
    const done = finished(manager, 'T-101');
    expect(await call(tools, 'assign_task', { agent: 'Pixel', title: 'Add toggle', brief: 'Make it' })).toMatchObject({ task_id: 'T-101', status: expect.any(String) });
    await done;
    const t = (await call(tools, 'get_task', { task_id: 'T-101' })) as Record<string, unknown>;
    expect(t).toMatchObject({ id: 'T-101', assignee: 'Pixel', status: 'review', files_changed: [{ path: 'notes.txt', add: 1, del: 0 }] });
    expect(String(t.result_summary)).toContain('Make it');
    expect(await call(tools, 'list_tasks', { status: 'review' })).toHaveLength(1);
  });

  it('refuses to hire when hiring is turned off', async () => {
    const { tools } = await setup({ bossCanHire: false });
    await expect(call(tools, 'hire', { role_id: 'frontend' })).rejects.toThrow(/Hiring is turned off/);
  });

  it('validates input from the model', async () => {
    const { tools } = await setup();
    await expect(call(tools, 'assign_task', { agent: 'Pixel' })).rejects.toThrow();
    await expect(call(tools, 'get_task', { task_id: 'T-999' })).rejects.toThrow(/Unknown task T-999/);
    await expect(call(tools, 'list_tasks', { status: 'sleeping' })).rejects.toThrow();
  });

  it('routes merge requests and reports through the deps', async () => {
    const { tools, manager, requestMerge, report } = await setup();
    await call(tools, 'hire', { role_id: 'frontend' });
    const done = finished(manager, 'T-101');
    await call(tools, 'assign_task', { agent: 'Pixel', title: 'a', brief: 'b' });
    await done;
    expect(await call(tools, 'request_merge', { task_id: 'T-101' })).toEqual({ status: 'awaiting_user_approval' });
    expect(requestMerge).toHaveBeenCalledWith(expect.objectContaining({ id: 'T-101' }));
    expect(await call(tools, 'report_to_user', { text: 'Halfway there' })).toEqual({ ok: true });
    expect(report).toHaveBeenCalledWith('Halfway there');
  });
});

describe('sync_branch', () => {
  it('switches the project folder to the base branch by default and reports what happened', async () => {
    const { tools, manager } = await setup();
    const { git } = await import('../src/main/git/worktrees');
    await git(h.repo, ['checkout', '-b', 'feature']);
    expect(await call(tools, 'sync_branch')).toMatchObject({ status: 'synced', branch: 'main', from: 'feature', remote: false });
    expect(await call(tools, 'sync_branch', { branch: 'nope' })).toMatchObject({ status: 'blocked' });
    await manager.idle();
  });
});
