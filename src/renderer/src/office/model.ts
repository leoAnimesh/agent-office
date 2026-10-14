import type { Agent, AgentStatus, Task } from '../../../shared/types';

export interface DisplayState { status: AgentStatus; bubble: string }

/** Live status, plus "waiting"/"paused" derived from the agent's queued work when they are idle. */
export function displayState(agent: Agent, tasks: Task[]): DisplayState {
  if (agent.status !== 'idle') return { status: agent.status, bubble: agent.bubble };
  const queued = tasks.find((t) => t.assigneeId === agent.id && t.status === 'queued');
  if (!queued) return { status: 'idle', bubble: agent.bubble || 'Idle' };
  if (queued.held) return { status: 'paused', bubble: `Paused: ${queued.title}` };
  if (queued.dependsOn.length > 0) return { status: 'waiting', bubble: `Waiting on ${queued.dependsOn.join(', ')}` };
  return { status: 'waiting', bubble: `Queued: ${queued.title}` };
}

export interface BoardLine { mark: '[x]' | '[>]' | '[?]' | '[!]' | '[ ]'; text: string; tone: 'done' | 'active' | 'review' | 'problem' | 'todo' }

const ORDER: Record<Task['status'], number> = { working: 0, needs_help: 1, failed: 1, review: 2, queued: 3, done: 4, cancelled: 5 };
const MARK: Record<Task['status'], Pick<BoardLine, 'mark' | 'tone'>> = {
  working: { mark: '[>]', tone: 'active' },
  needs_help: { mark: '[!]', tone: 'problem' },
  failed: { mark: '[!]', tone: 'problem' },
  review: { mark: '[?]', tone: 'review' },
  queued: { mark: '[ ]', tone: 'todo' },
  done: { mark: '[x]', tone: 'done' },
  cancelled: { mark: '[ ]', tone: 'todo' },
};

export function whiteboard(tasks: Task[], agents: Agent[], limit = 6): BoardLine[] {
  const who = (id: string) => agents.find((a) => a.id === id)?.name ?? '?';
  return tasks
    .filter((t) => t.status !== 'cancelled')
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit)
    .map((t) => ({ ...MARK[t.status], text: `${t.title} (${who(t.assigneeId)})` }));
}

export function statusCounts(states: DisplayState[]): { working: number; thinking: number; waiting: number; problem: number } {
  const c = { working: 0, thinking: 0, waiting: 0, problem: 0 };
  for (const s of states) {
    if (s.status === 'working') c.working++;
    else if (s.status === 'thinking') c.thinking++;
    else if (s.status === 'waiting' || s.status === 'paused') c.waiting++;
    else if (s.status === 'error') c.problem++;
  }
  return c;
}

export function progress(tasks: Task[]): { done: number; total: number } {
  const live = tasks.filter((t) => t.status !== 'cancelled');
  return { done: live.filter((t) => t.status === 'done').length, total: live.length };
}

export function splitTeam(agents: Agent[]): { boss: Agent | undefined; employees: Agent[] } {
  return { boss: agents.find((a) => a.kind === 'boss'), employees: agents.filter((a) => a.kind === 'employee') };
}
