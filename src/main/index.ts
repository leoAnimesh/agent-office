import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { IPC } from '../shared/ipc';
import type { AppSettings, AppStatus } from '../shared/types';
import { getAppStatus } from './appStatus';
import { isTrustedSender } from './ipcGuard';
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
  // Every channel checks that the request comes from our own page.
  const handle = (channel: string, fn: (...args: unknown[]) => unknown) =>
    ipcMain.handle(channel, (e, ...args) => {
      if (!isTrustedSender(e.senderFrame?.url, process.env.ELECTRON_RENDERER_URL)) throw new Error('Untrusted sender');
      return fn(...args);
    });
  handle(IPC.appStatus, async () => {
    status.current = statusFor(await settings.get());
    if (status.current.claude) svc.configure({ claudeBin: status.current.claude.path });
    return status.current;
  });
  handle(IPC.pickFolder, async () => {
    if (process.env.AO_E2E_PICK_FOLDER) return process.env.AO_E2E_PICK_FOLDER;
    const r = win ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] }) : await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0] ?? null;
  });
  handle(IPC.listProjects, () => svc.listProjects());
  handle(IPC.openProject, (repoPath: unknown, opts: unknown) => {
    const o = (typeof opts === 'object' && opts !== null ? opts : {}) as Record<string, unknown>;
    return svc.open(str(repoPath, 'folder'), {
      bossName: typeof o.bossName === 'string' ? o.bossName.slice(0, 40) : undefined,
      bossModel: typeof o.bossModel === 'string' ? o.bossModel.slice(0, 80) : undefined,
      bossCanHire: typeof o.bossCanHire === 'boolean' ? o.bossCanHire : undefined,
    });
  });
  handle(IPC.closeProject, () => svc.close());
  handle(IPC.updateProject, (patch: unknown) => svc.updateProject(patch));
  handle(IPC.snapshot, () => (svc.current() ? svc.snapshot() : null));
  handle(IPC.sendToBoss, (text: unknown) => svc.sendToBoss(str(text, 'message')));
  handle(IPC.listRoles, () => svc.listRoles());
  handle(IPC.saveRole, (role: unknown) => svc.saveRole(role));
  handle(IPC.listSkills, () => svc.listSkills());
  handle(IPC.saveSkill, (skill: unknown) => svc.saveSkill(skill));
  handle(IPC.hire, (roleId: unknown, name: unknown) => svc.hire(str(roleId, 'role'), typeof name === 'string' && name.trim() ? name.slice(0, 40) : undefined));
  handle(IPC.fireAgent, (id: unknown) => svc.fire(str(id, 'agent id')));
  handle(IPC.agentLog, (id: unknown) => svc.agentLog(str(id, 'agent id')));
  handle(IPC.messageAgent, async (id: unknown, text: unknown) => { await svc.messageAgent(str(id, 'agent id'), str(text, 'message')); });
  handle(IPC.openWorktree, async (id: unknown) => {
    const problem = await shell.openPath(svc.worktreeFor(str(id, 'agent id')));
    if (problem) throw new Error(problem);
  });
  handle(IPC.pauseTask, (id: unknown) => svc.pauseTask(str(id, 'task id')));
  handle(IPC.resumeTask, (id: unknown) => svc.resumeTask(str(id, 'task id')));
  handle(IPC.cancelTask, (id: unknown) => svc.cancelTask(str(id, 'task id')));
  handle(IPC.answerMerge, (requestId: unknown, ok: unknown) => svc.answerMerge(str(requestId, 'request id'), ok === true));
  handle(IPC.getSettings, () => settings.get());
  handle(IPC.saveSettings, async (patch: unknown) => {
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
