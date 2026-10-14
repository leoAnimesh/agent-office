import { useEffect, useState } from 'react';
import type { Project, WorkspaceSnapshot } from '../../../shared/types';

export function Onboarding({ onOpened }: { onOpened: (ws: WorkspaceSnapshot) => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { window.agentOffice.listProjects().then(setProjects, () => setProjects([])); }, []);

  const open = async (repoPath: string | null) => {
    if (!repoPath) return;
    setBusy(true);
    setError(null);
    try {
      onOpened(await window.agentOffice.openProject(repoPath));
    } catch (e) {
      setError(String(e).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, ''));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="boot">
      <h1>AgentOffice</h1>
      <p className="muted">Open a git repository. A boss agent will build the team for it.</p>
      <button type="button" className="btn primary" disabled={busy} onClick={async () => open(await window.agentOffice.pickFolder())}>
        {busy ? 'Opening…' : 'Open a project folder…'}
      </button>
      {error && <p className="bad" role="alert">{error}</p>}
      {projects.length > 0 && (
        <section aria-label="Recent projects">
          <h2>Recent projects</h2>
          <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {projects.map((p) => (
              <li key={p.id}>
                <button type="button" className="side-item" disabled={busy} onClick={() => open(p.repoPath)}>
                  <strong>{p.name}</strong> <span className="mono muted">{p.repoPath}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
