import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC, type AgentOfficeApi } from '../shared/ipc';
import type { WorkspaceEvent } from '../shared/types';

const api: AgentOfficeApi = {
  getStatus: () => ipcRenderer.invoke(IPC.appStatus),
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  pickFolder: () => ipcRenderer.invoke(IPC.pickFolder),
  listProjects: () => ipcRenderer.invoke(IPC.listProjects),
  openProject: (repoPath, opts) => ipcRenderer.invoke(IPC.openProject, repoPath, opts),
  createProject: (input) => ipcRenderer.invoke(IPC.createProject, input),
  defaultProjectsDir: () => ipcRenderer.invoke(IPC.defaultProjectsDir),
  closeProject: () => ipcRenderer.invoke(IPC.closeProject),
  updateProject: (patch) => ipcRenderer.invoke(IPC.updateProject, patch),
  setProjectSkills: (edit) => ipcRenderer.invoke(IPC.setProjectSkills, edit),
  listSkills: () => ipcRenderer.invoke(IPC.listSkills),
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
  moveTask: (id, beforeId) => ipcRenderer.invoke(IPC.moveTask, id, beforeId),
  reassignTask: (id, agent) => ipcRenderer.invoke(IPC.reassignTask, id, agent),
  mergeNow: (id) => ipcRenderer.invoke(IPC.mergeNow, id),
  answerMerge: (requestId, ok) => ipcRenderer.invoke(IPC.answerMerge, requestId, ok),
  historyBranches: () => ipcRenderer.invoke(IPC.historyBranches),
  historyList: (ref, skip, mergesOnly) => ipcRenderer.invoke(IPC.historyList, ref, skip, mergesOnly),
  historyCommit: (sha) => ipcRenderer.invoke(IPC.historyCommit, sha),
  historyDiff: (sha, path) => ipcRenderer.invoke(IPC.historyDiff, sha, path),
  terminalOpen: (cols, rows) => ipcRenderer.invoke(IPC.terminalOpen, cols, rows),
  terminalWrite: (data) => ipcRenderer.invoke(IPC.terminalWrite, data),
  terminalResize: (cols, rows) => ipcRenderer.invoke(IPC.terminalResize, cols, rows),
  terminalRestart: (cols, rows) => ipcRenderer.invoke(IPC.terminalRestart, cols, rows),
  onTerminal: (cb) => {
    const listener = (_e: unknown, ev: Parameters<typeof cb>[0]) => cb(ev);
    ipcRenderer.on(IPC.terminalEvent, listener);
    return () => { ipcRenderer.removeListener(IPC.terminalEvent, listener); };
  },
  previewList: () => ipcRenderer.invoke(IPC.previewList),
  previewWatch: (agentId) => ipcRenderer.invoke(IPC.previewWatch, agentId),
  previewAck: () => ipcRenderer.invoke(IPC.previewAck),
  previewInput: (agentId, event) => ipcRenderer.invoke(IPC.previewInput, agentId, event),
  previewReload: (agentId) => ipcRenderer.invoke(IPC.previewReload, agentId),
  previewStopDevServer: (agentId) => ipcRenderer.invoke(IPC.previewStopDevServer, agentId),
  onPreviewFrame: (cb) => {
    const listener = (_e: unknown, f: Parameters<typeof cb>[0]) => cb(f);
    ipcRenderer.on(IPC.previewFrame, listener);
    return () => { ipcRenderer.removeListener(IPC.previewFrame, listener); };
  },
  onEvent: (cb) => {
    const listener = (_e: IpcRendererEvent, event: WorkspaceEvent) => cb(event);
    ipcRenderer.on(IPC.event, listener);
    return () => { ipcRenderer.removeListener(IPC.event, listener); };
  },
};

contextBridge.exposeInMainWorld('agentOffice', api);
