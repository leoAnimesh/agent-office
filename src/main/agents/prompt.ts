import type { Role, Skill, Task } from '../../shared/types';

export interface PromptContext {
  agentName: string;
  bossName: string;
  branch: string;
  projectName: string;
  kind: 'boss' | 'employee';
}

export function renderPrompt(role: Role, skills: Skill[], ctx: PromptContext): string {
  const parts: string[] = [];
  if (ctx.kind === 'boss') {
    parts.push(`You are ${ctx.agentName}, the boss of the "${ctx.projectName}" team in AgentOffice.`);
  } else {
    parts.push(`You are ${ctx.agentName}, the ${role.name} on the "${ctx.projectName}" team. Your boss is ${ctx.bossName}.`);
  }
  parts.push(role.systemPrompt.trim());
  if (skills.length > 0) {
    parts.push('## Skills');
    for (const s of skills) parts.push(`### ${s.name}\n${s.body}`);
  }
  if (ctx.kind === 'boss') {
    parts.push(
      [
        '## How you work',
        '- You cannot edit files. Delegate all implementation to employees with `assign_task`.',
        '- Start by calling `list_team` and `list_roles`. If nobody fits, `hire` someone (if hiring is allowed).',
        '- Keep tasks small and independent. Use `depends_on` when a task needs another task merged first.',
        '- Messages that start with [AgentOffice] come from the app, not the user. When a task finishes, read it with `get_task`, then `request_merge` if it is good or `message_agent` with precise feedback if not.',
        '- You have no shell. To pull or switch the project folder\'s branch, use `sync_branch` (fast-forward only); anything else in git goes to an employee or the user.',
        '- Use `report_to_user` for short progress updates. Keep chat replies brief.',
      ].join('\n'),
    );
  }
  if (ctx.kind === 'employee') {
    parts.push(
      [
        '## Rules',
        `- Work only inside the current directory. It is your own git worktree on branch \`${ctx.branch}\`.`,
        '- Commit your work in small steps with clear messages. Do not switch branches.',
        '- Run the tests that cover your change before you finish.',
        '- Finish with a summary of at most 5 lines: what changed and how you verified it.',
      ].join('\n'),
    );
  }
  return parts.join('\n\n') + '\n';
}

export function taskMessage(task: Pick<Task, 'id' | 'title' | 'brief' | 'attempts'>): string {
  if (task.attempts > 0) {
    // The brief is repeated because the previous session may not have survived (crash, restart).
    return `Continue working on task ${task.id} ("${task.title}") from where you left off. Check the current state of the files first.\n\nThe brief, for reference:\n\n${task.brief.trim()}\n\nWhen you are finished, reply with a short summary (at most 5 lines).`;
  }
  return `# Task ${task.id}: ${task.title}\n\n${task.brief.trim()}\n\nWhen you are finished, reply with a short summary (at most 5 lines) of what you changed and how you verified it.`;
}
