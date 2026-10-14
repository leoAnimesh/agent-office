import { useState } from 'react';
import type { AppStatus } from '../../../shared/types';

export function NoClaude({ onFound }: { onFound: (s: AppStatus) => void }) {
  const [custom, setCustom] = useState('');
  const [note, setNote] = useState<string | null>(null);

  const check = async (saveCustom: boolean) => {
    if (saveCustom) await window.agentOffice.saveSettings({ claudePath: custom.trim() || null });
    const s = await window.agentOffice.getStatus();
    if (s.claude) onFound(s);
    else setNote(saveCustom && custom.trim() ? `No Claude Code binary at ${custom.trim()}.` : 'Still not found.');
  };

  return (
    <main className="boot" aria-labelledby="nc-title">
      <h1 id="nc-title" className="pixel">AgentOffice needs Claude Code</h1>
      <p>Your agents run on the Claude Code command-line tool, using your own Claude sign-in. It isn't installed on this computer, or AgentOffice can't find it.</p>
      <ol>
        <li>Install Claude Code by following the guide at <span className="mono">docs.claude.com/en/docs/claude-code</span>.</li>
        <li>Open a terminal, run <code>claude</code> once and sign in.</li>
        <li>Come back here and press <strong>Check again</strong>.</li>
      </ol>
      <div className="row"><button type="button" className="btn primary" onClick={() => void check(false)}>Check again</button></div>
      <form className="field" style={{ marginTop: 24 }} onSubmit={(e) => { e.preventDefault(); void check(true); }}>
        <label htmlFor="nc-path">Installed somewhere unusual? Path to the <code>claude</code> program</label>
        <div className="row">
          <input id="nc-path" className="input mono" style={{ flex: 1, minWidth: 240 }} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="/usr/local/bin/claude" />
          <button type="submit" className="btn">Use this path</button>
        </div>
      </form>
      {note && <p className="bad" role="alert">{note}</p>}
    </main>
  );
}
