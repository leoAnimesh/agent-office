import type { AgentOfficeApi } from '../../shared/ipc';

declare global {
  interface Window {
    agentOffice: AgentOfficeApi;
  }
}
export {};
