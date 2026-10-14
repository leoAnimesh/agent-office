import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type AgentOfficeApi } from '../shared/ipc';

const api: AgentOfficeApi = {
  getStatus: () => ipcRenderer.invoke(IPC.appStatus),
};

contextBridge.exposeInMainWorld('agentOffice', api);
