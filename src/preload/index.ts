import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC, type AgentOfficeApi } from '../shared/ipc';
import type { WorkspaceEvent } from '../shared/types';

const api: AgentOfficeApi = {
  getStatus: () => ipcRenderer.invoke(IPC.appStatus),
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  pickFolder: () => ipcRenderer.invoke(IPC.pickFolder),
  listProjects: () => ipcRenderer.invoke(IPC.listProjects),
  openProject: (repoPath, opts) => ipcRenderer.invoke(IPC.openProject, repoPath, opts),
  closeProject: () => ipcRenderer.invoke(IPC.closeProject),
  updateProject: (patch) => ipcRenderer.invoke(IPC.updateProject, patch),
  saveRole: (role) => ipcRenderer.invoke(IPC.saveRole, role),
  listSkills: () => ipcRenderer.invoke(IPC.listSkills),
  saveSkill: (skill) => ipcRenderer.invoke(IPC.saveSkill, skill),
  fireAgent: (agentId) => ipcRenderer.invoke(IPC.fireAgent, agentId),
  agentLog: (agentId) => ipcRenderer.invoke(IPC.agentLog, agentId),
  messageAgent: (agentId, text) => ipcRenderer.invoke(IPC.messageAgent, agentId, text),
  openWorktree: (agentId) => ipcRenderer.invoke(IPC.openWorktree, agentId),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  saveSettings: (patch) => ipcRenderer.invoke(IPC.saveSettings, patch),
  snapshot: () => ipcRenderer.invoke(IPC.snapshot),
  sendToBoss: (text) => ipcRenderer.invoke(IPC.sendToBoss, text),
  listRoles: () => ipcRenderer.invoke(IPC.listRoles),
  hire: (roleId, name) => ipcRenderer.invoke(IPC.hire, roleId, name),
  pauseTask: (id) => ipcRenderer.invoke(IPC.pauseTask, id),
  resumeTask: (id) => ipcRenderer.invoke(IPC.resumeTask, id),
  cancelTask: (id) => ipcRenderer.invoke(IPC.cancelTask, id),
  answerMerge: (requestId, ok) => ipcRenderer.invoke(IPC.answerMerge, requestId, ok),
  onEvent: (cb) => {
    const listener = (_e: IpcRendererEvent, event: WorkspaceEvent) => cb(event);
    ipcRenderer.on(IPC.event, listener);
    return () => { ipcRenderer.removeListener(IPC.event, listener); };
  },
};

contextBridge.exposeInMainWorld('agentOffice', api);
