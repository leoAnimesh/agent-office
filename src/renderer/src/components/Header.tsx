import type { Project } from '../../../shared/types';
import type { View } from '../state';

const TABS: { name: 'office' | 'tasks' | 'team'; label: string }[] = [
  { name: 'office', label: 'Office' },
  { name: 'tasks', label: 'Tasks' },
  { name: 'team', label: 'Team' },
];

export function Header({ project, view, openTasks, onNavigate }: { project: Project; view: View; openTasks: number; onNavigate: (v: View) => void }) {
  return (
    <>
      <header className="header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1>{project.name}</h1>
            <span className="chip">{project.baseBranch}</span>
          </div>
          <div className="mono small muted">{project.repoPath}</div>
        </div>
        <button type="button" className="btn primary" onClick={() => onNavigate({ name: 'team' })}>+ Hire agent</button>
      </header>
      <nav className="tabs" aria-label="Project views">
        {TABS.map((t) => (
          <button key={t.name} type="button" className="tab" aria-current={view.name === t.name ? 'page' : undefined} onClick={() => onNavigate({ name: t.name })}>
            {t.label}{t.name === 'tasks' && openTasks > 0 && <span className="chip" style={{ marginLeft: 6 }}>{openTasks}</span>}
          </button>
        ))}
      </nav>
    </>
  );
}
