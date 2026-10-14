import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'node:path';
import { IPC } from '../shared/ipc';
import { getAppStatus } from './appStatus';
import { fixGuiPath } from './claude/shellPath';
import { dataPaths } from './store/paths';
import { ProjectService } from './workspace/projectService';

let win: BrowserWindow | null = null;
let service: ProjectService | null = null;

const str = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || v.length === 0 || v.length > 100_000) throw new Error(`Invalid ${name}`);
  return v;
};

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#14151F',
    title: 'AgentOffice',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win?.webContents.getURL()) e.preventDefault();
  });
  win.on('closed', () => { win = null; });
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'));
}

function resourcesDir(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'resources') : path.join(app.getAppPath(), 'resources');
}

function registerIpc(svc: ProjectService): void {
  ipcMain.handle(IPC.appStatus, () => getAppStatus());
  ipcMain.handle(IPC.pickFolder, async () => {
    const r = win ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] }) : await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0] ?? null;
  });
  ipcMain.handle(IPC.listProjects, () => svc.listProjects());
  ipcMain.handle(IPC.openProject, (_e, repoPath: unknown) => svc.open(str(repoPath, 'folder')));
  ipcMain.handle(IPC.snapshot, () => (svc.current() ? svc.snapshot() : null));
  ipcMain.handle(IPC.sendToBoss, (_e, text: unknown) => svc.sendToBoss(str(text, 'message')));
  ipcMain.handle(IPC.listRoles, () => svc.listRoles());
  ipcMain.handle(IPC.hire, (_e, roleId: unknown, name: unknown) => svc.hire(str(roleId, 'role'), typeof name === 'string' && name.trim() ? name : undefined));
  ipcMain.handle(IPC.pauseTask, (_e, id: unknown) => svc.pauseTask(str(id, 'task id')));
  ipcMain.handle(IPC.resumeTask, (_e, id: unknown) => svc.resumeTask(str(id, 'task id')));
  ipcMain.handle(IPC.cancelTask, (_e, id: unknown) => svc.cancelTask(str(id, 'task id')));
  ipcMain.handle(IPC.answerMerge, (_e, requestId: unknown, ok: unknown) => svc.answerMerge(str(requestId, 'request id'), ok === true));
}

app.whenReady().then(async () => {
  fixGuiPath();
  const status = getAppStatus();
  service = new ProjectService({
    paths: dataPaths(app.getPath('userData')),
    resourcesDir: resourcesDir(),
    claudeBin: process.env.AO_CLAUDE_BIN ?? status.claude?.path ?? 'claude',
    isolateUserSettings: true,
  });
  await service.init();
  service.on('event', (e) => win?.webContents.send(IPC.event, e));
  registerIpc(service);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

let quitting = false;
app.on('before-quit', (e) => {
  if (quitting || !service) return;
  e.preventDefault();
  quitting = true;
  void service.close().finally(() => app.quit());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
