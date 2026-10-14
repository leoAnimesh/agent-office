import { z } from 'zod';
import type { Project, Task } from '../../shared/types';
import type { RoleStore } from '../store/roleStore';
import type { AgentManager } from './agentManager';

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

    tool('list_roles', 'List the role templates you can hire from.', {}, async () =>
      (await d.roles.list()).filter((r) => r.id !== 'boss').map((r) => ({ id: r.id, name: r.name, blurb: r.blurb })),
    ),

    tool('hire', 'Hire a new employee from a role template. Optionally give them a name.', { role_id: z.string(), name: z.string().optional() }, async ({ role_id, name }) => {
      if (!d.project.bossCanHire) throw new Error('Hiring is turned off for this project. Ask the user to hire someone.');
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

    tool('report_to_user', 'Post a short, highlighted progress update for the user.', { text: z.string().min(1) }, async ({ text }) => {
      d.report(text);
      return { ok: true };
    }),
  ];
}
