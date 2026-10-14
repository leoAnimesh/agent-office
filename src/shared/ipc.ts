export const IPC = {
  appStatus: 'app:status',
} as const;

export interface AgentOfficeApi {
  getStatus(): Promise<unknown>;
}
