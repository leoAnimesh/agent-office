import { useEffect, useState } from 'react';
import type { AppStatus, Project, WorkspaceSnapshot } from '../../../shared/types';
import type { View } from '../state';

interface Props { status: AppStatus; current: Project; view: View; onOpened: (ws: WorkspaceSnapshot) => void; onNewProject: () => void; onNavigate: (v: View) => void; onError: (m: string) => void }

export function Logo() {
  return (
    <svg width="30" height="30" viewBox="0 0 10 10" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="0" y="0" width="10" height="10" fill="#F5B942" />
      <rect x="1" y="1" width="5" height="4" fill="#14151F" />
      <rect x="2" y="2" width="3" height="1" fill="#52D1BE" />
      <rect x="3" y="5" width="1" height="1" fill="#14151F" />
      <rect x="1" y="6" width="8" height="1" fill="#8B5A34" />
      <rect x="1" y="7" width="1" height="2" fill="#8B5A34" />
      <rect x="8" y="7" width="1" height="2" fill="#8B5A34" />
      <rect x="7" y="2" width="2" height="2" fill="#14151F" />
      <rect x="7" y="4" width="2" height="2" fill="#2F9E8F" />
    </svg>
  );
}

export function Sidebar({ status, current, view, onOpened, onNewProject, onNavigate, onError }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  useEffect(() => { window.agentOffice.listProjects().then(setProjects, () => setProjects([])); }, [current.id]);

  const open = async (repoPath: string | null) => {
    if (!repoPath) return;
    try { onOpened(await window.agentOffice.openProject(repoPath)); } catch (e) { onError(String(e)); }
  };

  return (
    <nav className="sidebar" aria-label="Projects and library">
      <div className="brand"><Logo /> AgentOffice</div>
      <div className="side-section">
        <div className="side-title">PROJECTS</div>
        {projects.map((p) => (
          <button key={p.id} type="button" className={p.id === current.id ? 'side-item current' : 'side-item'} aria-current={p.id === current.id ? 'true' : undefined} onClick={() => (p.id === current.id ? onNavigate({ name: 'office' }) : open(p.repoPath))}>
            <span className="dot" style={{ background: p.id === current.id ? 'var(--amber)' : 'var(--blue)' }} aria-hidden="true" />
            <span className="side-label">{p.name}</span>
          </button>
        ))}
        <button type="button" className="side-item muted" onClick={onNewProject}>+ New project</button>
      </div>
      <div className="side-section">
        <div className="side-title">LIBRARY</div>
        <button type="button" className={view.name === 'team' ? 'side-item current' : 'side-item'} onClick={() => onNavigate({ name: 'team' })}>Roles &amp; skills</button>
        <button type="button" className={view.name === 'settings' ? 'side-item current' : 'side-item'} onClick={() => onNavigate({ name: 'settings' })}>Settings</button>
      </div>
      <div className="cli-card">
        <div className="small" style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
          <span className="dot" style={{ background: 'var(--green)' }} aria-hidden="true" /> Claude Code connected
        </div>
        <div className="mono small muted pre">{status.claude?.version ? `v${status.claude.version}\n` : ''}{status.claude?.path}</div>
      </div>
    </nav>
  );
}
