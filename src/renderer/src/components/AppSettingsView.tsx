import { useEffect, useState } from 'react';
import type { AppSettings, AppStatus } from '../../../shared/types';

interface Props { onStatus: (s: AppStatus) => void; onError: (m: string) => void }

/** App-wide settings (the sidebar's App settings). Project settings live in each project's Settings tab. */
export function AppSettingsView({ onStatus, onError }: Props) {
  const [app, setApp] = useState<AppSettings | null>(null);
  const [claudePath, setClaudePath] = useState('');
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => { window.agentOffice.getSettings().then((s) => { setApp(s); setClaudePath(s.claudePath ?? ''); }, () => undefined); }, []);

  const save = async () => {
    if (!app) return;
    try {
      await window.agentOffice.saveSettings({ claudePath: claudePath.trim() || null, isolateUserSettings: app.isolateUserSettings });
      const s = await window.agentOffice.getStatus();
      onStatus(s);
      setNote(s.claude ? `Using Claude Code at ${s.claude.path}. Applies to sessions started from now on.` : 'Claude Code was not found at that path.');
    } catch (e) { onError(String(e)); }
  };

  return (
    <div className="settings">
      {note && <p className="ok" role="status">{note}</p>}
      <section className="panel-box" aria-labelledby="set-app">
        <h2 id="set-app" style={{ margin: 0, fontSize: 16 }}>Claude Code</h2>
        <p className="small muted" style={{ margin: 0 }}>These apply to every project.</p>
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
        <div className="row"><button type="button" className="btn primary" onClick={() => void save()}>Save app settings</button></div>
      </section>
    </div>
  );
}
