import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { AppStatus, LogEntry, WorkspaceSnapshot } from '../../shared/types';
import { AgentDetailView } from './components/AgentDetailView';
import { BossChat } from './components/BossChat';
import { Header } from './components/Header';
import { OfficeView } from './components/OfficeView';
import { NoClaude } from './components/NoClaude';
import { Onboarding } from './components/Onboarding';
import { AppSettingsView } from './components/AppSettingsView';
import { ProjectSettingsView } from './components/ProjectSettingsView';
import { Sidebar } from './components/Sidebar';
import { TaskBoard } from './components/TaskBoard';
import { TeamView } from './components/TeamView';
import { HistoryView } from './components/HistoryView';
import { PreviewView } from './components/PreviewView';
import { TerminalPanel } from './components/TerminalPanel';
import { clampHeight, keyResize, readHeight, writeHeight } from './terminal/dock';
import { lookFor } from './sprites/sprite';
import { localStore, readLastProject, readProjectUi, writeLastProject, writeProjectUi } from './memory';
import { initialState, reducer, type View } from './state';

const clean = (m: string) => m.replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '');

export function App() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [state, dispatch] = useReducer(reducer, initialState);
  const [newProject, setNewProject] = useState(false);
  // The terminal dock: mounted on first open and then only hidden, so the shell and its scrollback survive toggling.
  const [termOpen, setTermOpen] = useState(false);
  const [termMounted, setTermMounted] = useState(false);
  const [termHeight, setTermHeight] = useState(() => readHeight(localStore(), window.innerHeight));
  // Only a project view has a terminal (not onboarding or App settings).
  const canTerminal = useRef(false);
  canTerminal.current = !!state.ws && state.view.name !== 'settings';
  const toggleTerminal = useCallback(() => {
    if (!canTerminal.current) return;
    setTermMounted(true);
    setTermOpen((o) => {
      if (o) requestAnimationFrame(() => document.getElementById('terminal-toggle')?.focus());
      return !o;
    });
  }, []);
  useEffect(() => {
    // Ctrl+` (Cmd+` is the macOS window switcher).
    const onKey = (e: KeyboardEvent) => { if (e.ctrlKey && !e.metaKey && !e.altKey && e.code === 'Backquote') { e.preventDefault(); toggleTerminal(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleTerminal]);
  // A hidden terminal must not start a shell in a project the user just switched to.
  const currentProject = state.ws?.project.id;
  useEffect(() => { if (!termOpen) setTermMounted(false); }, [currentProject]); // eslint-disable-line react-hooks/exhaustive-deps
  const resizeTo = (h: number) => { const next = clampHeight(h, window.innerHeight); setTermHeight(next); writeHeight(localStore(), next); };
  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setTermHeight(clampHeight(window.innerHeight - ev.clientY, window.innerHeight));
    const up = (ev: PointerEvent) => { resizeTo(window.innerHeight - ev.clientY); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const onError = useCallback((m: string) => dispatch({ type: 'error', message: clean(m) }), []);
  const viewAgentId = state.view.name === 'agent' ? state.view.agentId : null;
  const onLogs = useCallback((entries: LogEntry[]) => { if (viewAgentId) dispatch({ type: 'logs-loaded', agentId: viewAgentId, entries }); }, [viewAgentId]);
  const refreshRoles = useCallback(() => { window.agentOffice.listRoles().then((roles) => dispatch({ type: 'roles', roles }), () => undefined); }, []);
  // A project opens where the user left it: same tab, terminal open or closed as before.
  const opened = useCallback((snap: WorkspaceSnapshot) => {
    const ui = readProjectUi(localStore(), snap.project.id);
    writeLastProject(localStore(), snap.project.repoPath);
    if (ui.terminal) setTermMounted(true);
    setTermOpen(ui.terminal);
    dispatch({ type: 'snapshot', ws: snap, view: { name: ui.view } });
  }, []);
  // On launch, reopen the project that was open last time (once, and only when Claude Code was found).
  const [noSnapshot, setNoSnapshot] = useState(false);
  const [reopening, setReopening] = useState<string | null>(null);
  const triedReopen = useRef(false);

  useEffect(() => {
    window.agentOffice.getStatus().then(setStatus, () => setStatus({ platform: 'unknown', claude: null }));
    window.agentOffice.snapshot().then((ws) => { if (ws) opened(ws); else setNoSnapshot(true); }, () => setNoSnapshot(true));
    refreshRoles();
    // Files dropped outside the chat do nothing (instead of the window trying to open them).
    const guard = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); };
    document.addEventListener('dragover', guard);
    document.addEventListener('drop', guard);
    const off = window.agentOffice.onEvent((event) => {
      // The boss created or changed a role: reload names and looks so new hires show properly.
      if (event.type === 'roles-changed') refreshRoles();
      else dispatch({ type: 'event', event });
    });
    return () => { off(); document.removeEventListener('dragover', guard); document.removeEventListener('drop', guard); };
  }, [refreshRoles, opened]);

  useEffect(() => {
    if (!status?.claude || !noSnapshot || triedReopen.current) return;
    triedReopen.current = true;
    const last = readLastProject(localStore());
    if (!last) return;
    setReopening(last);
    // A folder that moved or was deleted is forgotten quietly; the project list is still there.
    window.agentOffice.openProject(last).then(opened, () => writeLastProject(localStore(), null)).finally(() => setReopening(null));
  }, [status, noSnapshot, opened]);

  // Opening a project can change the boss role (model picked during onboarding): reload roles.
  const projectId = state.ws?.project.id;
  useEffect(() => { if (projectId) refreshRoles(); }, [projectId, refreshRoles]);
  const viewName = state.view.name;
  useEffect(() => {
    if (projectId && (viewName === 'office' || viewName === 'tasks' || viewName === 'team' || viewName === 'history' || viewName === 'preview')) writeProjectUi(localStore(), projectId, { view: viewName });
  }, [projectId, viewName]);
  useEffect(() => { if (projectId) writeProjectUi(localStore(), projectId, { terminal: termOpen }); }, [termOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // A stable look for the chat header, so the memoized chat is not re-rendered by every agent event.
  const bossAgent = state.ws?.agents.find((a) => a.kind === 'boss');
  const bossLook = useMemo(() => (bossAgent ? lookFor(bossAgent, state.roles) : lookFor({ roleId: 'boss' }, state.roles)), [bossAgent?.id, bossAgent?.roleId, state.roles]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!status) return <main className="boot"><p>Looking for Claude Code…</p></main>;
  if (reopening) return <main className="boot"><p>Reopening {reopening.split(/[\\/]/).filter(Boolean).pop()}…</p></main>;
  if (!status.claude) return <NoClaude onFound={setStatus} />;
  const ws = state.ws;
  if (!ws) return <Onboarding status={status} onOpened={opened} />;

  const go = (view: View) => dispatch({ type: 'navigate', view });
  const boss = ws.agents.find((a) => a.kind === 'boss');
  const bossRole = state.roles.find((r) => r.id === 'boss');
  const openTasks = ws.tasks.filter((t) => ['queued', 'working', 'needs_help', 'review'].includes(t.status)).length;
  const withChat = state.view.name === 'office' || state.view.name === 'agent';

  const view = (() => {
    switch (state.view.name) {
      case 'office': return <OfficeView ws={ws} roles={state.roles} onOpenAgent={(id) => go({ name: 'agent', agentId: id })} />;
      case 'agent': return <AgentDetailView ws={ws} roles={state.roles} agentId={state.view.agentId} logs={state.logs[state.view.agentId] ?? []} onBack={() => go({ name: 'office' })} onLogs={onLogs} onError={onError} />;
      case 'team': return <TeamView ws={ws} roles={state.roles} onOpenAgent={(id) => go({ name: 'agent', agentId: id })} onError={onError} />;
      case 'tasks': return <TaskBoard ws={ws} roles={state.roles} onOpenAgent={(id) => go({ name: 'agent', agentId: id })} onViewCommit={(sha) => go({ name: 'history', sha })} onNewTask={() => { go({ name: 'office' }); setTimeout(() => document.getElementById('boss-msg')?.focus(), 0); }} onError={onError} />;
      case 'settings': return <AppSettingsView onStatus={setStatus} onError={onError} />;
      case 'preview': return <PreviewView ws={ws} onError={onError} />;
      case 'history': return <HistoryView key={state.view.sha ?? ''} ws={ws} sha={state.view.sha} onError={onError} />;
      case 'project-settings': return <ProjectSettingsView ws={ws} onClosed={() => { writeLastProject(localStore(), null); dispatch({ type: 'closed' }); }} onError={onError} />;
    }
  })();

  return (
    <div className="app">
      <Sidebar current={ws.project} view={state.view} onOpened={opened} onNewProject={() => setNewProject(true)} onNavigate={go} onError={onError} />
      {newProject && (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="New project">
          <Onboarding status={status} initialMode="create" onCancel={() => setNewProject(false)} onOpened={(snap) => { setNewProject(false); opened(snap); }} />
        </div>
      )}
      <div className="main">
        {/* App settings are app-wide: no project header or tabs above them. */}
        {state.view.name === 'settings'
          ? <header className="header"><h1>App settings</h1></header>
          : <Header project={ws.project} claude={status.claude} view={state.view} openTasks={openTasks} onNavigate={go} terminalOpen={termOpen} onToggleTerminal={toggleTerminal} />}
        {state.errors.length > 0 && (
          <div className="errors" role="alert">
            {state.errors.map((m, i) => (
              <div key={i} className="error-row"><span className="pre">{m}</span><button type="button" className="btn small" aria-label="Dismiss error" onClick={() => dispatch({ type: 'dismiss-error', index: i })}>×</button></div>
            ))}
          </div>
        )}
        <div className="content">
          <div className="view">{view}</div>
          {withChat && (
            <aside className="chat-panel">
              <BossChat chat={ws.chat} merges={ws.merges} boss={boss} bossLook={bossLook} bossModel={bossRole?.model ?? 'opus'} stream={state.bossStream} busy={state.bossBusy} onError={onError} />
            </aside>
          )}
        </div>
        {termMounted && state.view.name !== 'settings' && (
          <div className="terminal-dock" style={{ height: termHeight, display: termOpen ? undefined : 'none' }}>
            <div className="terminal-sep" role="separator" aria-orientation="horizontal" aria-label="Resize terminal" tabIndex={0}
              aria-valuenow={termHeight} aria-valuemin={120} aria-valuemax={Math.round(window.innerHeight * 0.7)}
              onPointerDown={startDrag}
              onKeyDown={(e) => { const next = keyResize(e.key, termHeight, window.innerHeight); if (next !== null) { e.preventDefault(); resizeTo(next); } }} />
            <TerminalPanel key={ws.project.id} projectId={ws.project.id} visible={termOpen} onError={onError} />
          </div>
        )}
      </div>
    </div>
  );
}

