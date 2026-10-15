import { z } from 'zod';
import { ALL_TOOLS } from '../../shared/tools';
import type { Project, Role, Task } from '../../shared/types';
import { slugify } from '../git/worktrees';
import { parseOrThrow, roleSchema } from '../store/validate';
import type { RoleStore } from '../store/roleStore';
import type { AgentManager } from './agentManager';

const MODEL = z.enum(['auto', 'opus', 'sonnet', 'haiku']);
const TOOL = z.enum(ALL_TOOLS as [string, ...string[]]);

/** Sprite colours for roles made from chat, picked from the role id so a role always looks the same. */
const LOOKS: Role['look'][] = [
  { hair: '#1F1B2E', shirt: '#5B6CD6', skin: '#B9825C' },
  { hair: '#E2583E', shirt: '#2F9E8F', skin: '#F1C9A5' },
  { hair: '#D9B44A', shirt: '#8E5BD0', skin: '#F3D9BF' },
  { hair: '#6B4224', shirt: '#E2584A', skin: '#C98E66' },
  { hair: '#8A90B0', shirt: '#C9935C', skin: '#E8C4A0' },
  { hair: '#2A2D42', shirt: '#4BA3E3', skin: '#9A6B4F' },
];
const lookForId = (id: string) => LOOKS[[...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % LOOKS.length];

export interface ToolDef {
  name: string;
  description: string;
  input: z.ZodRawShape;
  run(args: unknown): Promise<unknown>;
}

export interface BossToolDeps {
  manager: AgentManager;
  roles: RoleStore;
  project: Project;
  /** Merge now (auto-merge) or ask the user; returns what the boss should be told. */
  requestMerge(task: Task): Promise<unknown>;
  report(text: string): void;
}

function tool<S extends z.ZodRawShape>(name: string, description: string, input: S, run: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>): ToolDef {
  const schema = z.object(input);
  return { name, description, input, run: async (args) => run(schema.parse(args ?? {})) };
}

const STATUSES = ['queued', 'working', 'needs_help', 'review', 'done', 'failed', 'cancelled'] as const;

export function bossTools(d: BossToolDeps): ToolDef[] {
  const { manager } = d;
  const nameOf = (id: string) => manager.findAgent(id)?.name ?? 'unknown';
  const mustTask = (id: string): Task => {
    const t = manager.getTask(id);
    if (!t) throw new Error(`Unknown task ${id}`);
    return t;
  };
  const view = (t: Task, full = false) => ({
    id: t.id,
    title: t.title,
    assignee: nameOf(t.assigneeId),
    status: t.status,
    branch: t.branch,
    depends_on: t.dependsOn,
    ...(full ? { brief: t.brief, result_summary: t.resultSummary ?? null, files_changed: t.diffStat ?? [] } : {}),
  });

  return [
    tool('list_team', 'List your employees with their role, live status and current task.', {}, async () => {
      const roles = new Map((await d.roles.list()).map((r) => [r.id, r.name]));
      const tasks = manager.tasks();
      return manager.agents()
        .filter((a) => a.kind === 'employee')
        .map((a) => ({
          name: a.name,
          role: roles.get(a.roleId) ?? a.roleId,
          status: a.status,
          doing: a.bubble,
          current_task: tasks.find((t) => t.assigneeId === a.id && t.status === 'working')?.id ?? null,
        }));
    }),

    tool('list_roles', 'List the role templates you can hire from, with their model and tools.', {}, async () =>
      (await d.roles.list()).filter((r) => r.id !== 'boss').map((r) => ({ id: r.id, name: r.name, blurb: r.blurb, model: r.model, tools: r.allowedTools })),
    ),

    tool(
      'create_role',
      'Create a new role template when the user asks for one, then hire from it. Defaults: model "auto" (picked per task) and every tool.',
      { name: z.string().trim().min(1).max(60), description: z.string().max(120), system_prompt: z.string().min(1).max(20_000), model: MODEL.optional(), tools: z.array(TOOL).min(1).optional() },
      async (a) => {
        const id = slugify(a.name, 'role');
        if (id === 'boss' || (await d.roles.get(id))) throw new Error(`A role "${id}" already exists. Use update_role to change it.`);
        const role: Role = {
          id, name: a.name, blurb: a.description, systemPrompt: a.system_prompt, skills: [], model: a.model ?? 'auto',
          permissionMode: 'acceptEdits', allowedTools: a.tools ?? [...ALL_TOOLS], look: lookForId(id),
        };
        await d.roles.save(parseOrThrow(roleSchema, role, 'role') as Role);
        return { role_id: id, name: role.name, model: role.model, tools: role.allowedTools };
      },
    ),

    tool(
      'update_role',
      'Change a role template when the user asks (name, description, prompt, model, tools). Employees pick it up from their next task. The boss role cannot be changed.',
      { role_id: z.string(), name: z.string().trim().min(1).max(60).optional(), description: z.string().max(120).optional(), system_prompt: z.string().min(1).max(20_000).optional(), model: MODEL.optional(), tools: z.array(TOOL).min(1).optional() },
      async (a) => {
        if (a.role_id === 'boss') throw new Error('The boss role cannot be changed from chat.');
        const role = await d.roles.get(a.role_id);
        if (!role) throw new Error(`Unknown role: ${a.role_id}`);
        const next: Role = {
          ...role,
          name: a.name ?? role.name, blurb: a.description ?? role.blurb, systemPrompt: a.system_prompt ?? role.systemPrompt,
          model: a.model ?? role.model, allowedTools: a.tools ?? role.allowedTools,
        };
        await d.roles.save(parseOrThrow(roleSchema, next, 'role') as Role);
        return { role_id: next.id, name: next.name, model: next.model, tools: next.allowedTools };
      },
    ),

    tool('hire', 'Hire a new employee from a role template. Optionally give them a name.', { role_id: z.string(), name: z.string().optional() }, async ({ role_id, name }) => {
      const a = await manager.hire(role_id, name);
      const role = await d.roles.get(a.roleId);
      return { name: a.name, role: role?.name ?? a.roleId };
    }),

    tool(
      'assign_task',
      'Give an employee a task. They work on their own git branch and you are told when they finish. Use depends_on for tasks that need other tasks merged first.',
      { agent: z.string(), title: z.string().min(1), brief: z.string().min(1), depends_on: z.array(z.string()).optional() },
      async ({ agent, title, brief, depends_on }) => {
        const t = await manager.createTask({ assignee: agent, title, brief, dependsOn: depends_on, createdBy: 'boss' });
        const now = manager.getTask(t.id) ?? t;
        return { task_id: now.id, branch: now.branch, status: now.status };
      },
    ),

    tool('get_task', 'Read a task, including its result summary and changed files.', { task_id: z.string() }, async ({ task_id }) => view(mustTask(task_id), true)),

    tool('list_tasks', 'List tasks, optionally filtered by status.', { status: z.enum(STATUSES).optional() }, async ({ status }) =>
      manager.tasks().filter((t) => !status || t.status === status).map((t) => view(t)),
    ),

    tool('message_agent', 'Send a follow-up message to an employee (feedback, a question, a change request).', { agent: z.string(), text: z.string().min(1) }, async ({ agent, text }) => {
      const r = await manager.messageAgent(agent, text);
      return { delivered: r.delivered, task_id: r.taskId };
    }),

    tool('request_merge', "Ask to merge a reviewed task's branch into the main branch. The user may need to approve; you will get a message with the outcome.", { task_id: z.string() }, async ({ task_id }) =>
      d.requestMerge(mustTask(task_id)),
    ),

    tool('cancel_task', 'Cancel a task that is no longer needed.', { task_id: z.string() }, async ({ task_id }) => {
      mustTask(task_id);
      await manager.cancelTask(task_id);
      return { status: 'cancelled' };
    }),

    tool(
      'sync_branch',
      "Switch the user's project folder to a branch (default: the project's main branch) and pull it from origin, fast-forward only. Refuses if tracked files have uncommitted changes or the pull would need a merge. Use it when the user asks to pull, update or switch branches; merging finished work needs the folder back on the main branch.",
      { branch: z.string().min(1).max(200).optional() },
      async ({ branch }) => manager.syncBranch(branch ?? d.project.baseBranch),
    ),

    tool('report_to_user', 'Post a short, highlighted progress update for the user.', { text: z.string().min(1) }, async ({ text }) => {
      d.report(text);
      return { ok: true };
    }),
  ];
}
