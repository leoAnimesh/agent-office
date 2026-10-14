import type { Agent, AgentStatus, Look, Role } from '../../../shared/types';

export interface ScreenColors { screen: string; ink: string; dot: string }

export const STATUS_COLORS: Record<AgentStatus, ScreenColors> = {
  working: { screen: '#123B37', ink: '#52D1BE', dot: '#52D1BE' },
  thinking: { screen: '#3A3018', ink: '#F5B942', dot: '#F5B942' },
  waiting: { screen: '#1C2440', ink: '#7AA2FF', dot: '#7AA2FF' },
  done: { screen: '#1B3320', ink: '#8BD47A', dot: '#8BD47A' },
  error: { screen: '#3D1C1C', ink: '#FF7A6B', dot: '#FF7A6B' },
  idle: { screen: '#1A1C28', ink: '#4A4F66', dot: '#6E7288' },
  paused: { screen: '#1A1C28', ink: '#A3A6B8', dot: '#A3A6B8' },
};

export const STATUS_LABEL: Record<AgentStatus, string> = {
  working: 'Working', thinking: 'Thinking', waiting: 'Waiting', done: 'Done', error: 'Needs help', idle: 'Idle', paused: 'Paused',
};

export const FALLBACK_LOOK: Look = { hair: '#A3A6B8', shirt: '#33374A', skin: '#E8B48A' };

export function lookFor(agent: Pick<Agent, 'roleId'>, roles: Role[]): Look {
  return roles.find((r) => r.id === agent.roleId)?.look ?? FALLBACK_LOOK;
}

export function spriteClass(status: AgentStatus): string {
  return `sprite is-${status}`;
}

export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
