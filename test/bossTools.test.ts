import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bossTools, type ToolDef } from '../src/main/agents/bossTools';
import { finished, harness, type Harness } from './helpers/manager';
import { ALL_TOOLS } from '../src/shared/tools';
import type { Project } from '../src/shared/types';

let h: Harness;
beforeEach(async () => { h = await harness(); });
afterEach(async () => { await h.cleanup(); });

const call = (tools: ToolDef[], name: string, args: unknown = {}) => tools.find((t) => t.name === name)!.run(args);

async function setup(over: Partial<Project> = {}) {
  const env = await h.make();
  const project = Object.assign(env.project, over);
  const requestMerge = vi.fn(async () => ({ status: 'awaiting_user_approval' }));
  const report = vi.fn();
  const rolesChanged = vi.fn();
  const saveProject = vi.fn(async () => undefined);
  const tools = bossTools({ manager: env.manager, roles: env.roles, skills: env.skills, project, requestMerge, report, rolesChanged, saveProject });
  return { ...env, project, tools, requestMerge, report, rolesChanged, saveProject };
}

describe('bossTools', () => {
  it('exposes the documented tool set', async () => {
    const { tools } = await setup();
    expect(tools.map((t) => t.name).sort()).toEqual(['assign_task', 'cancel_task', 'create_role', 'get_task', 'hire', 'list_roles', 'list_skills', 'list_tasks', 'list_team', 'message_agent', 'report_to_user', 'request_merge', 'set_project_skills', 'sync_branch', 'update_role']);
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

  it('creates a role from chat with every tool and auto model by default, then hires from it', async () => {
    const { tools, roles } = await setup();
    const made = await call(tools, 'create_role', { name: 'Data Engineer', description: 'Pipelines, SQL', system_prompt: 'You build data pipelines.' });
    expect(made).toMatchObject({ role_id: 'data-engineer', name: 'Data Engineer', model: 'auto' });
    const role = (await roles.get('data-engineer'))!;
    expect(role).toMatchObject({ blurb: 'Pipelines, SQL', systemPrompt: 'You build data pipelines.', model: 'auto', permissionMode: 'acceptEdits' });
    expect(role.allowedTools).toEqual(ALL_TOOLS);
    expect(role.look.shirt).toMatch(/^#[0-9A-F]{6}$/);
    expect(await call(tools, 'hire', { role_id: 'data-engineer' })).toEqual({ name: 'Pixel', role: 'Data Engineer' });
    await expect(call(tools, 'create_role', { name: 'Data Engineer', description: 'x', system_prompt: 'x' })).rejects.toThrow(/already exists/);
  });

  it('changes a role from chat, and never the boss role', async () => {
    const { tools, roles } = await setup();
    expect(await call(tools, 'update_role', { role_id: 'frontend', model: 'opus', tools: ['Read', 'Edit'], system_prompt: 'Be careful.' })).toMatchObject({ role_id: 'frontend', model: 'opus' });
    expect(await roles.get('frontend')).toMatchObject({ model: 'opus', allowedTools: ['Read', 'Edit'], systemPrompt: 'Be careful.', name: 'Frontend Engineer' });
    await expect(call(tools, 'update_role', { role_id: 'boss', model: 'haiku' })).rejects.toThrow(/boss/);
    await expect(call(tools, 'update_role', { role_id: 'nope', model: 'haiku' })).rejects.toThrow(/Unknown role/);
    await expect(call(tools, 'update_role', { role_id: 'frontend', tools: ['Teleport'] })).rejects.toThrow();
    await expect(call(tools, 'update_role', { role_id: 'frontend', model: 'gpt-5' })).rejects.toThrow();
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

describe('role changes are visible', () => {
  it('tells the app and posts what changed, including the new instructions', async () => {
    const { tools, report, rolesChanged } = await setup();
    await call(tools, 'create_role', { name: 'Data Engineer', description: 'Pipelines', system_prompt: 'You build data pipelines.' });
    expect(rolesChanged).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenLastCalledWith(expect.stringMatching(/Created role \*\*Data Engineer\*\*[\s\S]*auto[\s\S]*You build data pipelines\./));
    await call(tools, 'update_role', { role_id: 'frontend', model: 'opus', system_prompt: 'Ship it.' });
    expect(rolesChanged).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenLastCalledWith(expect.stringMatching(/Changed role \*\*Frontend Engineer\*\*[\s\S]*model: sonnet → opus|model: auto → opus/));
    expect(report.mock.lastCall![0]).toContain('Ship it.');
  });
});

describe('project skills in employee prompts', () => {
  it('gives employees the project skills, not the role skills, and picks up changes on the next task', async () => {
    const { manager, project } = await h.make();
    await manager.hire('frontend');
    const promptOf = async () => fs.readFile(path.join(h.paths.promptDir, `${manager.findAgent('Pixel')!.id}.md`), 'utf8');

    let done = finished(manager, 'T-101');
    await manager.createTask({ assignee: 'Pixel', title: 'a', brief: 'a', createdBy: 'user' });
    await done;
    expect(await promptOf()).not.toContain('## Skills'); // unchosen: none, even though the role lists four

    project.skills = [{ id: 'docker', reason: 'x', addedBy: 'boss' }, { id: 'missing-skill', reason: 'x', addedBy: 'user' }];
    done = finished(manager, 'T-102');
    await manager.createTask({ assignee: 'Pixel', title: 'b', brief: 'b', createdBy: 'user' });
    await done;
    const text = await promptOf();
    expect(text).toContain('### Docker');
    expect(text).not.toContain('### React patterns');
  });
});

describe('project skills tools', () => {
  it('lists the library with project flags', async () => {
    const { tools } = await setup({ skills: [{ id: 'docker', reason: 'x', addedBy: 'user' }], skillsExcluded: ['vue'] });
    const list = (await call(tools, 'list_skills')) as Record<string, unknown>[];
    expect(list).toHaveLength(22);
    expect(list.find((s) => s.id === 'docker')).toMatchObject({ name: 'Docker', in_project: true, added_by: 'user', excluded: false, tags: ['ops', 'docker'] });
    expect(list.find((s) => s.id === 'vue')).toMatchObject({ in_project: false, excluded: true });
    expect(list.find((s) => s.id === 'vue')).not.toHaveProperty('added_by');
  });

  it('sets the project skills, keeps user ones, reports skips, and saves', async () => {
    const { tools, project, saveProject } = await setup({ skills: [{ id: 'docker', reason: 'mine', addedBy: 'user' }], skillsExcluded: ['vue'] });
    const r = await call(tools, 'set_project_skills', { skills: [{ id: 'typescript', reason: 'TS repo' }, { id: 'vue', reason: 'x' }] });
    expect(r).toEqual({
      skills: [{ id: 'docker', reason: 'mine', added_by: 'user' }, { id: 'typescript', reason: 'TS repo', added_by: 'boss' }],
      kept_user_skills: ['docker'],
      skipped: [{ id: 'vue', why: 'removed by the user' }],
      note: 'Employees get these from their next task.',
    });
    expect(project.skills!.map((s) => s.id)).toEqual(['docker', 'typescript']);
    expect(saveProject).toHaveBeenCalledOnce();
  });

  it('refuses unknown ids and too many, leaving the set unchanged', async () => {
    const { tools, project, saveProject } = await setup();
    await expect(call(tools, 'set_project_skills', { skills: [{ id: 'nope', reason: 'x' }] })).rejects.toThrow(/Unknown skills: nope/);
    await expect(call(tools, 'set_project_skills', { skills: Array.from({ length: 13 }, () => ({ id: 'docker', reason: 'x' })) })).rejects.toThrow();
    expect(project.skills).toBeUndefined();
    expect(saveProject).not.toHaveBeenCalled();
  });

  it('reminds the boss on assign_task only while skills are unchosen', async () => {
    const { tools, project } = await setup();
    await call(tools, 'hire', { role_id: 'frontend' });
    expect(await call(tools, 'assign_task', { agent: 'Pixel', title: 'a', brief: 'a' })).toMatchObject({ reminder: expect.stringContaining('set_project_skills') });
    project.skills = [];
    expect(await call(tools, 'assign_task', { agent: 'Pixel', title: 'b', brief: 'b' })).not.toHaveProperty('reminder');
  });
});
