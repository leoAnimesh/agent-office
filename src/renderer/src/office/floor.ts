import type { Agent, Task } from '../../../shared/types';
import { displayState, type DisplayState } from './model';

export type CafeActivity = 'coffee' | 'snack' | 'chat';

export interface DeskSpot { agent: Agent; state: DisplayState; away: boolean }
export interface CafeSpot { agent: Agent; activity: CafeActivity; label: string }

export interface FloorPlan {
  boss: DeskSpot | undefined;
  desks: DeskSpot[];
  cafeteria: CafeSpot[];
  washroom: { agent: Agent } | null;
}

/** How long an idle agent keeps doing the same thing before picking something new. */
export const SLOT_MS = 120_000;

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** Free for a break: nothing running, nothing queued, nothing waiting on them. */
function onBreak(state: DisplayState): boolean {
  return state.status === 'idle' || state.status === 'done';
}

/**
 * Where everyone is right now. Busy agents sit at their desks; idle employees leave an empty chair
 * and go to the cafeteria (coffee, a snack, or a chat with another idle agent) or, one at a time,
 * the washroom. Deterministic for a given time slot so the office never flickers between renders.
 */
export function planFloor(agents: Agent[], tasks: Task[], slot: number): FloorPlan {
  const bossAgent = agents.find((a) => a.kind === 'boss');
  const boss = bossAgent ? { agent: bossAgent, state: displayState(bossAgent, tasks), away: false } : undefined;
  const desks: DeskSpot[] = agents
    .filter((a) => a.kind === 'employee')
    .map((agent) => { const state = displayState(agent, tasks); return { agent, state, away: onBreak(state) }; });

  let washroom: FloorPlan['washroom'] = null;
  const picks: { agent: Agent; activity: CafeActivity }[] = [];
  const away = desks.filter((d) => d.away).map((d) => d.agent).sort((a, b) => hash(`${a.id}:${slot}`) - hash(`${b.id}:${slot}`));
  for (const agent of away) {
    const roll = hash(`${agent.id}#${slot}`) % 10;
    if (roll === 0 && !washroom) washroom = { agent };
    else picks.push({ agent, activity: roll <= 4 ? 'coffee' : roll <= 7 ? 'snack' : 'chat' });
  }

  // Chatting needs a partner: pair them up in order; a leftover goes for coffee instead.
  const chatters = picks.filter((p) => p.activity === 'chat');
  if (chatters.length % 2 === 1) chatters.pop()!.activity = 'coffee';
  const partner = new Map<string, string>();
  for (let i = 0; i + 1 < chatters.length; i += 2) {
    partner.set(chatters[i].agent.id, chatters[i + 1].agent.name);
    partner.set(chatters[i + 1].agent.id, chatters[i].agent.name);
  }

  const cafeteria = picks.map(({ agent, activity }) => ({
    agent,
    activity,
    label: activity === 'coffee' ? 'Coffee break' : activity === 'snack' ? 'Snack time' : `Chatting with ${partner.get(agent.id)}`,
  }));
  return { boss, desks, cafeteria, washroom };
}
