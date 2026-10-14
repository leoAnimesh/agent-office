import type { Agent, Task } from '../../../shared/types';
import { displayState, type DisplayState } from './model';

export type CafeActivity = 'coffee' | 'snack' | 'chat';

export type DeskAction = 'stretch' | 'read' | 'coffee' | 'phone';
export interface DeskSpot { agent: Agent; state: DisplayState; away: boolean; idle?: { action: DeskAction; label: string } }
export interface CafeSpot { agent: Agent; activity: CafeActivity; label: string }

export interface FloorPlan {
  boss: DeskSpot | undefined;
  desks: DeskSpot[];
  cafeteria: CafeSpot[];
  washroom: { agent: Agent } | null;
}

/** How long an idle agent keeps doing the same thing before picking something new. */
export const SLOT_MS = 90_000;

const DESK_ACTIONS: { action: DeskAction; label: string }[] = [
  { action: 'stretch', label: 'Stretching' },
  { action: 'read', label: 'Reading docs' },
  { action: 'coffee', label: 'Sipping coffee' },
  { action: 'phone', label: 'Checking phone' },
];

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
  const free = desks.filter((d) => d.away).map((d) => d.agent).sort((a, b) => hash(`${a.id}:${slot}`) - hash(`${b.id}:${slot}`));
  const stayAtDesk = (agent: Agent) => {
    const spot = desks.find((d) => d.agent.id === agent.id)!;
    spot.away = false;
    spot.idle = DESK_ACTIONS[hash(`${agent.id}~${slot}`) % DESK_ACTIONS.length];
  };
  for (const agent of free) {
    // 40% idle at the desk, 10% washroom (one at a time), the rest in the cafeteria.
    const roll = hash(`${agent.id}#${slot}`) % 10;
    if (roll >= 6) stayAtDesk(agent);
    else if (roll === 0) { if (washroom) stayAtDesk(agent); else washroom = { agent }; }
    else picks.push({ agent, activity: roll <= 2 ? 'coffee' : roll === 3 ? 'snack' : 'chat' });
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
