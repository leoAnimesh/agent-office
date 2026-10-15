import type { AppStatus, Project } from '../../../shared/types';
import { claudeLabel } from '../layout/claudeLabel';
import type { View } from '../state';

const TABS: { name: 'office' | 'tasks' | 'team' | 'project-settings'; label: string }[] = [
  { name: 'office', label: 'Office' },
  { name: 'tasks', label: 'Tasks' },
  { name: 'team', label: 'Team' },
  { name: 'project-settings', label: 'Settings' },
];

export function Header({ project, claude, view, openTasks, onNavigate }: { project: Project; claude: AppStatus['claude']; view: View; openTasks: number; onNavigate: (v: View) => void }) {
  const agent = claude ? claudeLabel(claude) : null;
  return (
    <>
      <header className="header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1>{project.name}</h1>
            <span className="chip">{project.baseBranch}</span>
            {agent && (
              // The coding agent this project runs on. Only Claude Code exists today; a picker comes with a second agent.
              <span className="agent-badge" title={agent.title}><span className="dot" style={{ background: 'var(--green)' }} aria-hidden="true" />{agent.text}<span className="sr-only"> · connected</span></span>
            )}
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
