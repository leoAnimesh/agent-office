import type { Agent, AgentStatus, Role, Task } from '../../../shared/types';
import { displayState } from '../office/model';
import { STATUS_LABEL } from '../sprites/sprite';
import { byQueueOrder } from '../../../shared/queueOrder';

export interface TeamCard { status: AgentStatus; label: string; bubble: string; task: { id: string; title: string } | null; model: string; done: number }

/** What a Team card shows: live status, the task that matters now, the model in use and how much got merged. */
export function teamCard(agent: Agent, tasks: Task[], role: Role | undefined): TeamCard {
  const mine = tasks.filter((t) => t.assigneeId === agent.id);
  const pick = (s: Task['status'][]) => mine.find((t) => s.includes(t.status));
  const current = pick(['working']) ?? pick(['needs_help', 'failed']) ?? pick(['review']) ?? mine.filter((t) => t.status === 'queued').sort(byQueueOrder)[0];
  const state = displayState(agent, tasks);
  const roleModel = role?.model ?? '';
  return {
    status: state.status,
    label: STATUS_LABEL[state.status],
    bubble: state.bubble,
    task: current ? { id: current.id, title: current.title } : null,
    model: roleModel === 'auto' && current?.model ? `auto · ${current.model}` : roleModel,
    done: mine.filter((t) => t.status === 'done').length,
  };
}
