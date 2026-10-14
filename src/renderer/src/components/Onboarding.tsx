import { useEffect, useState } from 'react';
import type { AppStatus, Project, WorkspaceSnapshot } from '../../../shared/types';
import { DeskSprite } from '../sprites/DeskSprite';
import { MODELS } from '../team/roleForm';

const BOSS_LOOK = { hair: '#3B2A20', shirt: '#2B3350', skin: '#E8B48A' };
const clean = (m: string) => m.replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '');

export function Onboarding({ status, onOpened }: { status: AppStatus; onOpened: (ws: WorkspaceSnapshot) => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [folder, setFolder] = useState('');
  const [bossName, setBossName] = useState('Max');
  const [bossModel, setBossModel] = useState('opus');
  const [canHire, setCanHire] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { window.agentOffice.listProjects().then(setProjects, () => setProjects([])); }, []);

  const open = async (repoPath: string, fresh: boolean) => {
    setBusy(true);
    setError(null);
    try {
      onOpened(await window.agentOffice.openProject(repoPath, fresh ? { bossName: bossName.trim() || 'Max', bossModel, bossCanHire: canHire } : undefined));
    } catch (e) {
      setError(clean(String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="onboarding-wrap">
      <div className="onboarding-card">
        <div className="onboarding-art">
          <DeskSprite name={bossName.trim() || 'Max'} role="Boss" look={BOSS_LOOK} status="waiting" bubble="Ready when you are" />
          <div className="pixel" style={{ fontSize: 26, color: '#f2efe6' }}>Your office is empty.</div>
          <div className="small" style={{ color: '#e0d2c6', maxWidth: 260 }}>Hire a boss, point it at a repo, and it will build the rest of the team.</div>
        </div>
        <form className="onboarding-form" onSubmit={(e) => { e.preventDefault(); if (folder.trim()) void open(folder.trim(), true); }}>
          <div>
            <h1 className="pixel" style={{ margin: '0 0 6px', fontSize: 30 }}>Welcome to AgentOffice</h1>
            <p className="muted" style={{ margin: 0 }}>Three steps. Agents run on your local Claude Code, so you don't need an API key.</p>
          </div>
          <div className="step">
            <span className="step-badge done" aria-hidden="true">✓</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>Claude Code found</div>
              <div className="mono small muted" style={{ overflowWrap: 'anywhere' }}>{status.claude?.path}{status.claude?.version ? ` · v${status.claude.version}` : ''}</div>
            </div>
          </div>
          <div className="step">
            <span className="step-badge active" aria-hidden="true">2</span>
            <div className="field" style={{ flex: 1, minWidth: 0 }}>
              <label htmlFor="ob-folder" style={{ fontWeight: 600, color: 'var(--text)', fontSize: 14 }}>Project folder</label>
              <div className="row">
                <input id="ob-folder" className="input mono" style={{ flex: 1, minWidth: 0 }} value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="Pick a git repository" />
                <button type="button" className="btn" onClick={async () => { const p = await window.agentOffice.pickFolder(); if (p) setFolder(p); }}>Browse</button>
              </div>
              <span className="small muted">Must be a git repo with at least one commit. Each agent gets its own worktree in .agentoffice/wt/</span>
            </div>
          </div>
          <div className="step">
            <span className="step-badge" aria-hidden="true">3</span>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontWeight: 600 }}>Hire your boss</span>
              <div className="grid-2">
                <div className="field"><label htmlFor="ob-name">Name</label><input id="ob-name" className="input" value={bossName} maxLength={40} onChange={(e) => setBossName(e.target.value)} /></div>
                <div className="field"><label htmlFor="ob-model">Model</label><select id="ob-model" className="input" value={bossModel} onChange={(e) => setBossModel(e.target.value)}>{MODELS.map((m) => <option key={m}>{m}</option>)}</select></div>
              </div>
              <label className="row small"><input type="checkbox" checked={canHire} onChange={(e) => setCanHire(e.target.checked)} style={{ width: 18, height: 18, accentColor: 'var(--teal)' }} /> Let the boss hire employees on its own</label>
            </div>
          </div>
          {error && <p className="bad" role="alert" style={{ margin: 0 }}>{error}</p>}
          <button type="submit" className="btn primary" style={{ alignSelf: 'flex-end' }} disabled={busy || !folder.trim()}>{busy ? 'Opening…' : 'Open the office →'}</button>
          {projects.length > 0 && (
            <section aria-label="Recent projects" style={{ borderTop: '1px solid var(--line)', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <h2 style={{ margin: 0, fontSize: 14 }} className="muted">Recent projects</h2>
              {projects.map((p) => (
                <button key={p.id} type="button" className="side-item" disabled={busy} onClick={() => void open(p.repoPath, false)}>
                  <strong>{p.name}</strong><span className="mono small muted side-label">{p.repoPath}</span>
                </button>
              ))}
            </section>
          )}
        </form>
      </div>
    </div>
  );
}
