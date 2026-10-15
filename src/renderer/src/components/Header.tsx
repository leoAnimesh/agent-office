import type { AppStatus, Project } from '../../../shared/types';
import { claudeLabel } from '../layout/claudeLabel';
import type { View } from '../state';

const TABS: { name: 'office' | 'tasks' | 'team' | 'history' | 'preview' | 'project-settings'; label: string }[] = [
  { name: 'office', label: 'Office' },
  { name: 'tasks', label: 'Tasks' },
  { name: 'team', label: 'Team' },
  { name: 'history', label: 'History' },
  { name: 'preview', label: 'Preview' },
  { name: 'project-settings', label: 'Settings' },
];

export function Header({ project, claude, view, openTasks, onNavigate, terminalOpen, onToggleTerminal }: { project: Project; claude: AppStatus['claude']; view: View; openTasks: number; onNavigate: (v: View) => void; terminalOpen: boolean; onToggleTerminal: () => void }) {
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
        <button id="terminal-toggle" type="button" className="btn" aria-pressed={terminalOpen} aria-keyshortcuts="Control+`" title="Terminal (Ctrl+`)" onClick={onToggleTerminal}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" shapeRendering="crispEdges" aria-hidden="true"><path d="M1 2h14v12H1zM2 3v10h12V3zM4 5h2v2H4zM6 7h2v2H6zM4 9h2v2H4zM8 10h4v1H8z" fillRule="evenodd" /></svg>
          Terminal
        </button>
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
