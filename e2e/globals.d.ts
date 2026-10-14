import type { AgentOfficeApi } from '../src/shared/ipc';

declare global {
  interface Window {
    agentOffice: AgentOfficeApi;
  }
}
export {};
