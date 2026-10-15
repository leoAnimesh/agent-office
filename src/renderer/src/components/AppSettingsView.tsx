import { useEffect, useState } from 'react';
import type { AppSettings, AppStatus, DeviceSupport } from '../../../shared/types';

interface Props { onStatus: (s: AppStatus) => void; onError: (m: string) => void }

/** App-wide settings (the sidebar's App settings). Project settings live in each project's Settings tab. */
export function AppSettingsView({ onStatus, onError }: Props) {
  const [app, setApp] = useState<AppSettings | null>(null);
  const [claudePath, setClaudePath] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [support, setSupport] = useState<DeviceSupport | null>(null);
  useEffect(() => { window.agentOffice.deviceSupport().then(setSupport, () => undefined); }, []);
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
      <section className="panel-box" aria-labelledby="set-devices">
        <h2 id="set-devices" style={{ margin: 0, fontSize: 16 }}>Mobile devices</h2>
        <p className="small muted" style={{ margin: 0 }}>Employees can test apps on an Android emulator and an iOS Simulator installed on this computer.</p>
        {!support ? <p className="small muted" style={{ margin: 0 }}>Checking…</p> : (
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            <li>Android: {support.android.ok ? `ready (${support.android.avds.join(', ')})` : support.android.reason}</li>
            <li>iOS: {support.ios.ok ? `ready (${support.ios.devices.slice(0, 3).map((d) => d.name).join(', ')})${support.ios.idb ? '' : ' · view only until idb is installed: brew install facebook/fb/idb-companion and pip3 install fb-idb'}` : support.ios.reason}</li>
          </ul>
        )}
      </section>
    </div>
  );
}
