import { useState } from 'react';
import type { WorkspaceSnapshot } from '../../../shared/types';

interface Props { ws: WorkspaceSnapshot; onClosed: () => void; onError: (m: string) => void }

/** Settings for the open project only (the header's Settings tab). App-wide settings live in the sidebar. */
export function ProjectSettingsView({ ws, onClosed, onError }: Props) {
  const [max, setMax] = useState(String(ws.project.maxConcurrent));
  const [autoMerge, setAutoMerge] = useState(ws.project.autoMerge);
  const [browserTools, setBrowserTools] = useState(ws.project.browserTools !== false);
  const [note, setNote] = useState<string | null>(null);

  const save = async () => {
    try {
      await window.agentOffice.updateProject({ maxConcurrent: Number(max), autoMerge, browserTools });
      setNote('Project settings saved.');
    } catch (e) { onError(String(e)); }
  };
  const close = async () => {
    try { await window.agentOffice.closeProject(); onClosed(); } catch (e) { onError(String(e)); }
  };

  return (
    <div className="settings">
      {note && <p className="ok" role="status">{note}</p>}
      <section className="panel-box" aria-labelledby="set-project">
        <h2 id="set-project" style={{ margin: 0, fontSize: 16 }}>{ws.project.name}</h2>
        <div className="field">
          <label htmlFor="set-max">Agents working at the same time (1–8)</label>
          <input id="set-max" className="input" type="number" min={1} max={8} value={max} onChange={(e) => setMax(e.target.value)} style={{ maxWidth: 120 }} />
        </div>
        <label className="row"><input type="checkbox" checked={autoMerge} onChange={(e) => setAutoMerge(e.target.checked)} style={{ width: 18, height: 18 }} /> Merge finished work without asking me</label>
        <label className="row"><input type="checkbox" checked={browserTools} onChange={(e) => setBrowserTools(e.target.checked)} style={{ width: 18, height: 18 }} /> Employees can use a browser to check their work</label>
        <div className="row"><button type="button" className="btn primary" onClick={() => void save()}>Save project settings</button></div>
      </section>
      <section className="panel-box" aria-labelledby="set-close">
        <h2 id="set-close" style={{ margin: 0, fontSize: 16 }}>Close project</h2>
        <p className="small muted" style={{ margin: 0 }}>Stops every agent in this project. Running tasks pick up again when you reopen it.</p>
        <div className="row"><button type="button" className="btn danger" onClick={() => void close()}>Close {ws.project.name}</button></div>
      </section>
    </div>
  );
}
