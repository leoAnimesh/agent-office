import { useCallback, useEffect, useReducer, useState } from 'react';
import type { AppStatus, LogEntry } from '../../shared/types';
import { AgentDetailView } from './components/AgentDetailView';
import { BossChat } from './components/BossChat';
import { Header } from './components/Header';
import { OfficeView } from './components/OfficeView';
import { NoClaude } from './components/NoClaude';
import { Onboarding } from './components/Onboarding';
import { SettingsView } from './components/SettingsView';
import { Sidebar } from './components/Sidebar';
import { TaskBoard } from './components/TaskBoard';
import { TeamView } from './components/TeamView';
import { lookFor } from './sprites/sprite';
import { initialState, reducer, type View } from './state';

const clean = (m: string) => m.replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '');

export function App() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [state, dispatch] = useReducer(reducer, initialState);
  const onError = useCallback((m: string) => dispatch({ type: 'error', message: clean(m) }), []);
  const viewAgentId = state.view.name === 'agent' ? state.view.agentId : null;
  const onLogs = useCallback((entries: LogEntry[]) => { if (viewAgentId) dispatch({ type: 'logs-loaded', agentId: viewAgentId, entries }); }, [viewAgentId]);
  const refreshRoles = useCallback(() => { window.agentOffice.listRoles().then((roles) => dispatch({ type: 'roles', roles }), () => undefined); }, []);

  useEffect(() => {
    window.agentOffice.getStatus().then(setStatus, () => setStatus({ platform: 'unknown', claude: null }));
    window.agentOffice.snapshot().then((ws) => { if (ws) dispatch({ type: 'snapshot', ws }); }, () => undefined);
    refreshRoles();
    return window.agentOffice.onEvent((event) => dispatch({ type: 'event', event }));
  }, [refreshRoles]);

  // Opening a project can change the boss role (model picked during onboarding): reload roles.
  const projectId = state.ws?.project.id;
  useEffect(() => { if (projectId) refreshRoles(); }, [projectId, refreshRoles]);

  if (!status) return <main className="boot"><p>Looking for Claude Code…</p></main>;
  if (!status.claude) return <NoClaude onFound={setStatus} />;
  const ws = state.ws;
  if (!ws) return <Onboarding status={status} onOpened={(snap) => dispatch({ type: 'snapshot', ws: snap })} />;

  const go = (view: View) => dispatch({ type: 'navigate', view });
  const boss = ws.agents.find((a) => a.kind === 'boss');
  const bossRole = state.roles.find((r) => r.id === 'boss');
  const openTasks = ws.tasks.filter((t) => ['queued', 'working', 'needs_help', 'review'].includes(t.status)).length;
  const withChat = state.view.name === 'office' || state.view.name === 'agent';

  const view = (() => {
    switch (state.view.name) {
      case 'office': return <OfficeView ws={ws} roles={state.roles} onOpenAgent={(id) => go({ name: 'agent', agentId: id })} onHire={() => go({ name: 'team' })} />;
      case 'agent': return <AgentDetailView ws={ws} roles={state.roles} agentId={state.view.agentId} logs={state.logs[state.view.agentId] ?? []} onBack={() => go({ name: 'office' })} onLogs={onLogs} onError={onError} />;
      case 'team': return <TeamView ws={ws} roles={state.roles} onRolesChanged={refreshRoles} onOpenAgent={(id) => go({ name: 'agent', agentId: id })} onError={onError} />;
      case 'tasks': return <TaskBoard ws={ws} roles={state.roles} onOpenAgent={(id) => go({ name: 'agent', agentId: id })} onNewTask={() => { go({ name: 'office' }); setTimeout(() => document.getElementById('boss-msg')?.focus(), 0); }} onError={onError} />;
      case 'settings': return <SettingsView ws={ws} onStatus={setStatus} onClosed={() => dispatch({ type: 'closed' })} onError={onError} />;
    }
  })();

  return (
    <div className="app">
      <Sidebar status={status} current={ws.project} view={state.view} onOpened={(snap) => dispatch({ type: 'snapshot', ws: snap })} onNavigate={go} onError={onError} />
      <div className="main">
        <Header project={ws.project} view={state.view} openTasks={openTasks} onNavigate={go} />
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
              <BossChat chat={ws.chat} merges={ws.merges} boss={boss} bossLook={boss ? lookFor(boss, state.roles) : lookFor({ roleId: 'boss' }, state.roles)} bossModel={bossRole?.model ?? 'opus'} onError={onError} />
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
