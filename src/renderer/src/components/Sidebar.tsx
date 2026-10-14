import { useEffect, useState } from 'react';
import type { AppStatus, Project, WorkspaceSnapshot } from '../../../shared/types';
import type { View } from '../state';
import { claudeLabel } from '../layout/sidebarPref';

interface Props { status: AppStatus; current: Project; view: View; collapsed: boolean; onToggle: () => void; onOpened: (ws: WorkspaceSnapshot) => void; onNewProject: () => void; onNavigate: (v: View) => void; onError: (m: string) => void }

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

function Icon({ name }: { name: 'roles' | 'settings' | 'plus' | 'collapse' | 'expand' }) {
  const paths: Record<typeof name, string> = {
    roles: 'M5 2h3v3H5zM10 3h2v2h-2zM3 7h7v2H3zM3 9h2v4H3zm5 0h2v4H8zM10 7h3v2h-3zm1 2h2v3h-2z',
    settings: 'M7 1h2v2H7zM7 13h2v2H7zM1 7h2v2H1zM13 7h2v2h-2zM3 3h2v2H3zM11 3h2v2h-2zM3 11h2v2H3zM11 11h2v2h-2zM5 5h6v6H5zm2 2v2h2V7z',
    plus: 'M7 2h2v12H7zM2 7h12v2H2z',
    collapse: 'M9 3h2v2H9zM7 5h2v2H7zM5 7h2v2H5zM7 9h2v2H7zM9 11h2v2H9z',
    expand: 'M5 3h2v2H5zM7 5h2v2H7zM9 7h2v2H9zM7 9h2v2H7zM5 11h2v2H5z',
  };
  return <svg width="16" height="16" viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true" fill="currentColor" fillRule="evenodd"><path d={paths[name]} /></svg>;
}

export function Sidebar({ status, current, view, collapsed, onToggle, onOpened, onNewProject, onNavigate, onError }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  useEffect(() => { window.agentOffice.listProjects().then(setProjects, () => setProjects([])); }, [current.id]);

  const open = async (repoPath: string | null) => {
    if (!repoPath) return;
    try { onOpened(await window.agentOffice.openProject(repoPath)); } catch (e) { onError(String(e)); }
  };
  const claude = status.claude ? claudeLabel(status.claude) : null;
  // Collapsed, every item keeps its accessible name; the visible label becomes a tooltip.
  const tip = (label: string) => (collapsed ? { 'aria-label': label, title: label } : {});

  return (
    <nav className={collapsed ? 'sidebar collapsed' : 'sidebar'} aria-label="Projects and library">
      <div className="brand">
        <Logo />
        {!collapsed && <span className="brand-name">AgentOffice</span>}
        <button type="button" className="side-toggle" aria-expanded={!collapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={onToggle}>
          <Icon name={collapsed ? 'expand' : 'collapse'} />
        </button>
      </div>
      <div className="side-section">
        {!collapsed && <div className="side-title">PROJECTS</div>}
        {projects.map((p) => (
          <button key={p.id} type="button" className={p.id === current.id ? 'side-item current' : 'side-item'} aria-current={p.id === current.id ? 'true' : undefined} {...tip(p.name)} onClick={() => (p.id === current.id ? onNavigate({ name: 'office' }) : open(p.repoPath))}>
            <span className="dot" style={{ background: p.id === current.id ? 'var(--amber)' : 'var(--blue)' }} aria-hidden="true" />
            {!collapsed && <span className="side-label">{p.name}</span>}
          </button>
        ))}
        <button type="button" className="side-item muted" {...tip('New project')} onClick={onNewProject}>
          <Icon name="plus" />{!collapsed && <span className="side-label">New project</span>}
        </button>
      </div>
      <div className="side-section">
        {!collapsed && <div className="side-title">LIBRARY</div>}
        <button type="button" className={view.name === 'team' ? 'side-item current' : 'side-item'} {...tip('Roles & skills')} onClick={() => onNavigate({ name: 'team' })}>
          <Icon name="roles" />{!collapsed && <span className="side-label">Roles &amp; skills</span>}
        </button>
        <button type="button" className={view.name === 'settings' ? 'side-item current' : 'side-item'} {...tip('Settings')} onClick={() => onNavigate({ name: 'settings' })}>
          <Icon name="settings" />{!collapsed && <span className="side-label">Settings</span>}
        </button>
      </div>
      {claude && (
        <div className="cli-card" title={claude.title}>
          <span className="dot" style={{ background: 'var(--green)' }} aria-hidden="true" />
          <span className={collapsed ? 'sr-only' : 'side-label'}>{collapsed ? claude.title : claude.text}</span>
        </div>
      )}
    </nav>
  );
}
