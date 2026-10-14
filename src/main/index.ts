import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { IPC } from '../shared/ipc';
import type { AppSettings, AppStatus } from '../shared/types';
import { getAppStatus } from './appStatus';
import { claudeVersion, systemLocateEnv } from './claude/locate';
import { fixGuiPath } from './claude/shellPath';
import { dataPaths } from './store/paths';
import { SettingsStore } from './store/settingsStore';
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

// Test-only overrides (see README "Develop").
if (process.env.AO_USER_DATA) app.setPath('userData', process.env.AO_USER_DATA);
const TEST_BIN = process.env.AO_CLAUDE_BIN;
const TEST_ARGS: string[] = (() => {
  try { const v: unknown = JSON.parse(process.env.AO_CLAUDE_ARGS ?? '[]'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; } catch { return []; }
})();

function statusFor(settings: AppSettings): AppStatus {
  if (process.env.AO_CLAUDE_MISSING === '1') return { platform: process.platform, claude: null };
  if (TEST_BIN) return { platform: process.platform, claude: { path: TEST_BIN, version: 'test' } };
  return getAppStatus({ locate: systemLocateEnv(), override: settings.claudePath ?? undefined, version: claudeVersion });
}

function registerIpc(svc: ProjectService, settings: SettingsStore, status: { current: AppStatus }): void {
  ipcMain.handle(IPC.appStatus, () => status.current);
  ipcMain.handle(IPC.pickFolder, async () => {
    if (process.env.AO_E2E_PICK_FOLDER) return process.env.AO_E2E_PICK_FOLDER;
    const r = win ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] }) : await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0] ?? null;
  });
  ipcMain.handle(IPC.listProjects, () => svc.listProjects());
  ipcMain.handle(IPC.openProject, (_e, repoPath: unknown, opts: unknown) => {
    const o = (typeof opts === 'object' && opts !== null ? opts : {}) as Record<string, unknown>;
    return svc.open(str(repoPath, 'folder'), {
      bossName: typeof o.bossName === 'string' ? o.bossName.slice(0, 40) : undefined,
      bossModel: typeof o.bossModel === 'string' ? o.bossModel.slice(0, 80) : undefined,
      bossCanHire: typeof o.bossCanHire === 'boolean' ? o.bossCanHire : undefined,
    });
  });
  ipcMain.handle(IPC.closeProject, () => svc.close());
  ipcMain.handle(IPC.updateProject, (_e, patch: unknown) => svc.updateProject(patch));
  ipcMain.handle(IPC.snapshot, () => (svc.current() ? svc.snapshot() : null));
  ipcMain.handle(IPC.sendToBoss, (_e, text: unknown) => svc.sendToBoss(str(text, 'message')));
  ipcMain.handle(IPC.listRoles, () => svc.listRoles());
  ipcMain.handle(IPC.saveRole, (_e, role: unknown) => svc.saveRole(role));
  ipcMain.handle(IPC.listSkills, () => svc.listSkills());
  ipcMain.handle(IPC.saveSkill, (_e, skill: unknown) => svc.saveSkill(skill));
  ipcMain.handle(IPC.hire, (_e, roleId: unknown, name: unknown) => svc.hire(str(roleId, 'role'), typeof name === 'string' && name.trim() ? name.slice(0, 40) : undefined));
  ipcMain.handle(IPC.fireAgent, (_e, id: unknown) => svc.fire(str(id, 'agent id')));
  ipcMain.handle(IPC.agentLog, (_e, id: unknown) => svc.agentLog(str(id, 'agent id')));
  ipcMain.handle(IPC.messageAgent, async (_e, id: unknown, text: unknown) => { await svc.messageAgent(str(id, 'agent id'), str(text, 'message')); });
  ipcMain.handle(IPC.openWorktree, async (_e, id: unknown) => {
    const problem = await shell.openPath(svc.worktreeFor(str(id, 'agent id')));
    if (problem) throw new Error(problem);
  });
  ipcMain.handle(IPC.pauseTask, (_e, id: unknown) => svc.pauseTask(str(id, 'task id')));
  ipcMain.handle(IPC.resumeTask, (_e, id: unknown) => svc.resumeTask(str(id, 'task id')));
  ipcMain.handle(IPC.cancelTask, (_e, id: unknown) => svc.cancelTask(str(id, 'task id')));
  ipcMain.handle(IPC.answerMerge, (_e, requestId: unknown, ok: unknown) => svc.answerMerge(str(requestId, 'request id'), ok === true));
  ipcMain.handle(IPC.getSettings, () => settings.get());
  ipcMain.handle(IPC.saveSettings, async (_e, patch: unknown) => {
    const next = await settings.save((typeof patch === 'object' && patch !== null ? patch : {}) as Partial<AppSettings>);
    status.current = statusFor(next);
    svc.configure({ claudeBin: status.current.claude?.path ?? 'claude', isolateUserSettings: next.isolateUserSettings });
    return next;
  });
}

app.whenReady().then(async () => {
  fixGuiPath();
  const paths = dataPaths(app.getPath('userData'));
  const settings = new SettingsStore(paths.settingsFile);
  const current = await settings.get();
  const status = { current: statusFor(current) };
  service = new ProjectService({
    paths,
    resourcesDir: resourcesDir(),
    claudeBin: status.current.claude?.path ?? 'claude',
    claudeBinArgs: TEST_ARGS.length > 0 ? TEST_ARGS : undefined,
    isolateUserSettings: current.isolateUserSettings,
  });
  await service.init();
  service.on('event', (e) => win?.webContents.send(IPC.event, e));
  registerIpc(service, settings, status);
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
