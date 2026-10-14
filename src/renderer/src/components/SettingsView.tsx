import { useEffect, useState } from 'react';
import type { AppSettings, AppStatus, WorkspaceSnapshot } from '../../../shared/types';

interface Props { ws: WorkspaceSnapshot; onStatus: (s: AppStatus) => void; onClosed: () => void; onError: (m: string) => void }

export function SettingsView({ ws, onStatus, onClosed, onError }: Props) {
  const [max, setMax] = useState(String(ws.project.maxConcurrent));
  const [autoMerge, setAutoMerge] = useState(ws.project.autoMerge);
  const [canHire, setCanHire] = useState(ws.project.bossCanHire);
  const [app, setApp] = useState<AppSettings | null>(null);
  const [claudePath, setClaudePath] = useState('');
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => { window.agentOffice.getSettings().then((s) => { setApp(s); setClaudePath(s.claudePath ?? ''); }, () => undefined); }, []);

  const saveProject = async () => {
    try {
      await window.agentOffice.updateProject({ maxConcurrent: Number(max), autoMerge, bossCanHire: canHire });
      setNote('Project settings saved.');
    } catch (e) { onError(String(e)); }
  };
  const saveApp = async () => {
    if (!app) return;
    try {
      await window.agentOffice.saveSettings({ claudePath: claudePath.trim() || null, isolateUserSettings: app.isolateUserSettings });
      const s = await window.agentOffice.getStatus();
      onStatus(s);
      setNote(s.claude ? `Using Claude Code at ${s.claude.path}. Applies to sessions started from now on.` : 'Claude Code was not found at that path.');
    } catch (e) { onError(String(e)); }
  };
  const close = async () => {
    try { await window.agentOffice.closeProject(); onClosed(); } catch (e) { onError(String(e)); }
  };

  return (
    <div className="settings">
      {note && <p className="ok" role="status">{note}</p>}
      <section className="panel-box" aria-labelledby="set-project">
        <h2 id="set-project" style={{ margin: 0, fontSize: 16 }}>This project</h2>
        <div className="field">
          <label htmlFor="set-max">Agents working at the same time (1–8)</label>
          <input id="set-max" className="input" type="number" min={1} max={8} value={max} onChange={(e) => setMax(e.target.value)} style={{ maxWidth: 120 }} />
        </div>
        <label className="row"><input type="checkbox" checked={autoMerge} onChange={(e) => setAutoMerge(e.target.checked)} style={{ width: 18, height: 18 }} /> Merge finished work without asking me</label>
        <label className="row"><input type="checkbox" checked={canHire} onChange={(e) => setCanHire(e.target.checked)} style={{ width: 18, height: 18 }} /> Let the boss hire employees on its own</label>
        <div className="row"><button type="button" className="btn primary" onClick={() => void saveProject()}>Save project settings</button></div>
      </section>
      <section className="panel-box" aria-labelledby="set-app">
        <h2 id="set-app" style={{ margin: 0, fontSize: 16 }}>App</h2>
        <div className="field">
          <label htmlFor="set-claude">Path to Claude Code (leave empty to detect it)</label>
          <input id="set-claude" className="input mono" value={claudePath} onChange={(e) => setClaudePath(e.target.value)} placeholder="Detected automatically" />
        </div>
        {app && (
          <label className="row">
            <input type="checkbox" checked={app.isolateUserSettings} onChange={(e) => setApp({ ...app, isolateUserSettings: e.target.checked })} style={{ width: 18, height: 18 }} />
            Keep my personal Claude Code hooks and plugins out of agent sessions (recommended)
          </label>
        )}
        <div className="row"><button type="button" className="btn" onClick={() => void saveApp()}>Save app settings</button></div>
      </section>
      <section className="panel-box" aria-labelledby="set-close">
        <h2 id="set-close" style={{ margin: 0, fontSize: 16 }}>Close project</h2>
        <p className="small muted" style={{ margin: 0 }}>Stops every agent in this project. Running tasks pick up again when you reopen it.</p>
        <div className="row"><button type="button" className="btn danger" onClick={() => void close()}>Close {ws.project.name}</button></div>
      </section>
    </div>
  );
}
