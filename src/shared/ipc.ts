import type { AppStatus } from './types';

export const IPC = {
  appStatus: 'app:status',
} as const;

export interface AgentOfficeApi {
  getStatus(): Promise<AppStatus>;
}
