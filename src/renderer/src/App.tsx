import { useEffect, useState } from 'react';
import type { AppStatus } from '../../shared/types';

export function App() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.agentOffice.getStatus().then(setStatus, (e: unknown) => setError(String(e)));
  }, []);

  return (
    <main className="boot">
      <h1>AgentOffice</h1>
      {error && <p className="bad">Could not check for Claude Code: {error}</p>}
      {!status && !error && <p>Looking for Claude Code…</p>}
      {status?.claude && (
        <p className="ok">
          Claude Code {status.claude.version ?? '(unknown version)'} found at <code>{status.claude.path}</code>
        </p>
      )}
      {status && !status.claude && (
        <div className="bad">
          <p>Claude Code was not found on this computer.</p>
          <p>Install it, sign in with <code>claude</code> once in a terminal, then restart AgentOffice.</p>
        </div>
      )}
    </main>
  );
}
