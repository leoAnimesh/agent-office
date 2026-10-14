import { useCallback, useEffect, useReducer, useState } from 'react';
import type { AppStatus } from '../../shared/types';
import { BossChat } from './components/BossChat';
import { Header } from './components/Header';
import { OfficeView } from './components/OfficeView';
import { Onboarding } from './components/Onboarding';
import { Sidebar } from './components/Sidebar';
import { TaskBoard } from './components/TaskBoard';
import { lookFor } from './sprites/sprite';
import { initialState, reducer, type View } from './state';

const clean = (m: string) => m.replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '');

export function App() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [state, dispatch] = useReducer(reducer, initialState);
  const onError = useCallback((m: string) => dispatch({ type: 'error', message: clean(m) }), []);
  const refreshRoles = useCallback(() => { window.agentOffice.listRoles().then((roles) => dispatch({ type: 'roles', roles }), () => undefined); }, []);

  useEffect(() => {
    window.agentOffice.getStatus().then(setStatus, () => setStatus({ platform: 'unknown', claude: null }));
    window.agentOffice.snapshot().then((ws) => { if (ws) dispatch({ type: 'snapshot', ws }); }, () => undefined);
    refreshRoles();
    return window.agentOffice.onEvent((event) => dispatch({ type: 'event', event }));
  }, [refreshRoles]);

  if (!status) return <main className="boot"><p>Looking for Claude Code…</p></main>;
  if (!status.claude) {
    return (
      <main className="boot">
        <h1 className="pixel">AgentOffice</h1>
        <p className="bad">Claude Code was not found on this computer. Install it, sign in with <code>claude</code> once in a terminal, then restart AgentOffice.</p>
      </main>
    );
  }
  const ws = state.ws;
  if (!ws) return <Onboarding onOpened={(snap) => dispatch({ type: 'snapshot', ws: snap })} />;

  const go = (view: View) => dispatch({ type: 'navigate', view });
  const boss = ws.agents.find((a) => a.kind === 'boss');
  const bossRole = state.roles.find((r) => r.id === 'boss');
  const openTasks = ws.tasks.filter((t) => ['queued', 'working', 'needs_help', 'review'].includes(t.status)).length;
  const withChat = state.view.name === 'office' || state.view.name === 'agent';

  const view = (() => {
    switch (state.view.name) {
      case 'office': return <OfficeView ws={ws} roles={state.roles} onOpenAgent={(id) => go({ name: 'agent', agentId: id })} onHire={() => go({ name: 'team' })} />;
      case 'tasks': return <TaskBoard tasks={ws.tasks} agents={ws.agents} onError={onError} />;
      default: return <p className="muted">This view arrives in a later step.</p>;
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
