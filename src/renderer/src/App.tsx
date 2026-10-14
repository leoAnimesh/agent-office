import { useEffect, useReducer, useState } from 'react';
import type { AppStatus } from '../../shared/types';
import { Onboarding } from './components/Onboarding';
import { Workspace } from './components/Workspace';
import { initialState, reducer } from './state';

export function App() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    window.agentOffice.getStatus().then(setStatus, () => setStatus({ platform: 'unknown', claude: null }));
    window.agentOffice.snapshot().then((ws) => { if (ws) dispatch({ type: 'snapshot', ws }); }, () => undefined);
    return window.agentOffice.onEvent((event) => dispatch({ type: 'event', event }));
  }, []);

  if (!status) return <main className="boot"><p>Looking for Claude Code…</p></main>;
  if (!status.claude) {
    return (
      <main className="boot">
        <h1>AgentOffice</h1>
        <div className="bad">
          <p>Claude Code was not found on this computer.</p>
          <p>Install it, sign in with <code>claude</code> once in a terminal, then restart AgentOffice.</p>
        </div>
      </main>
    );
  }
  if (!state.ws) return <Onboarding onOpened={(ws) => dispatch({ type: 'snapshot', ws })} />;
  return <Workspace state={state} onError={(message) => dispatch({ type: 'error', message })} onDismiss={(index) => dispatch({ type: 'dismiss-error', index })} />;
}
