import { useEffect, useState } from 'react';
import type { Project, WorkspaceSnapshot } from '../../../shared/types';
import type { View } from '../state';
import logo from '../../../shared/logo.json';

interface Props { current: Project; view: View; collapsed: boolean; onToggle: () => void; onOpened: (ws: WorkspaceSnapshot) => void; onNewProject: () => void; onNavigate: (v: View) => void; onError: (m: string) => void }

/** The app logo, drawn from the same pixel grid as the app icon (src/shared/logo.json). */
export function Logo({ size = 32 }: { size?: number }) {
  const palette = logo.palette as Record<string, string>;
  // Centre the art by its own bounds, like the app icon (an odd-width building can't centre on 16 cells).
  const cells = logo.grid.flatMap((row, y) => [...row].map((c, x) => ({ c, x, y }))).filter((p) => p.c !== '.');
  const span = (k: 'x' | 'y') => Math.min(...cells.map((p) => p[k])) + Math.max(...cells.map((p) => p[k])) + 1;
  const dx = (16 - span('x')) / 2, dy = (16 - span('y')) / 2;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
      <rect width="16" height="16" rx="3" fill={logo.tile} shapeRendering="geometricPrecision" />
      <g transform={`translate(${dx} ${dy})`}>{cells.map(({ c, x, y }) => <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={palette[c]} />)}</g>
    </svg>
  );
}

function Icon({ name }: { name: 'settings' | 'plus' | 'collapse' | 'expand' }) {
  const paths: Record<typeof name, string> = {
    settings: 'M7 1h2v2H7zM7 13h2v2H7zM1 7h2v2H1zM13 7h2v2h-2zM3 3h2v2H3zM11 3h2v2h-2zM3 11h2v2H3zM11 11h2v2h-2zM5 5h6v6H5zm2 2v2h2V7z',
    plus: 'M7 2h2v12H7zM2 7h12v2H2z',
    collapse: 'M9 3h2v2H9zM7 5h2v2H7zM5 7h2v2H5zM7 9h2v2H7zM9 11h2v2H9z',
    expand: 'M5 3h2v2H5zM7 5h2v2H7zM9 7h2v2H9zM7 9h2v2H7zM5 11h2v2H5z',
  };
  return <svg width="16" height="16" viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true" fill="currentColor" fillRule="evenodd"><path d={paths[name]} /></svg>;
}

export function Sidebar({ current, view, collapsed, onToggle, onOpened, onNewProject, onNavigate, onError }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  useEffect(() => { window.agentOffice.listProjects().then(setProjects, () => setProjects([])); }, [current.id]);

  const open = async (repoPath: string | null) => {
    if (!repoPath) return;
    try { onOpened(await window.agentOffice.openProject(repoPath)); } catch (e) { onError(String(e)); }
  };
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
      <div className="side-section side-bottom">
        <button type="button" className={view.name === 'settings' ? 'side-item current' : 'side-item'} aria-current={view.name === 'settings' ? 'page' : undefined} {...tip('App settings')} onClick={() => onNavigate({ name: 'settings' })}>
          <Icon name="settings" />{!collapsed && <span className="side-label">App settings</span>}
        </button>
      </div>
    </nav>
  );
}
