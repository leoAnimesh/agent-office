import { useEffect, useState } from 'react';
import type { Agent, Role, RunnerEvent } from '../../../shared/types';

const dot: Record<Agent['status'], string> = {
  idle: '#6e7288', thinking: '#f5b942', working: '#52d1be', waiting: '#7aa2ff', done: '#8bd47a', error: '#ff7a6b', paused: '#a3a6b8',
};

function logLine(e: RunnerEvent): string | null {
  switch (e.type) {
    case 'tool_use': return `${e.name} ${JSON.stringify(e.input).slice(0, 80)}`;
    case 'text': return e.text.slice(0, 160);
    case 'result': return e.ok ? 'finished' : `failed: ${e.text.slice(0, 120)}`;
    case 'stderr': return `stderr: ${e.text.slice(0, 120)}`;
    default: return null;
  }
}

export function TeamPanel({ agents, logs, onError }: { agents: Agent[]; logs: Record<string, RunnerEvent[]>; onError: (m: string) => void }) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [roleId, setRoleId] = useState('frontend');
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => { window.agentOffice.listRoles().then(setRoles, () => setRoles([])); }, []);
  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? id;
  const lines = (selected ? logs[selected] ?? [] : []).map(logLine).filter((l): l is string => l !== null).slice(-30);

  const hire = async () => {
    try {
      await window.agentOffice.hire(roleId, name.trim() || undefined);
      setName('');
    } catch (e) {
      onError(String(e));
    }
  };

  return (
    <section className="panel team" aria-label="Team">
      <h2>Team</h2>
      <ul className="agents">
        {agents.map((a) => (
          <li key={a.id}>
            <button type="button" className={selected === a.id ? 'agent selected' : 'agent'} onClick={() => setSelected(selected === a.id ? null : a.id)}>
              <span className="dot" style={{ background: dot[a.status] }} aria-hidden="true" />
              <span className="agent-name">{a.name}</span>
              <span className="muted small">{a.kind === 'boss' ? 'Boss' : roleName(a.roleId)}</span>
              <span className="bubble small">{a.bubble}</span>
            </button>
          </li>
        ))}
      </ul>
      {selected && (
        <div className="log mono small" aria-label="Agent activity">
          {lines.length === 0 ? <p className="muted">No activity yet.</p> : lines.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}
      <form className="hire" onSubmit={(e) => { e.preventDefault(); void hire(); }}>
        <label htmlFor="hire-role">Hire</label>
        <select id="hire-role" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
          {roles.filter((r) => r.id !== 'boss').map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <label htmlFor="hire-name" className="sr-only">Name (optional)</label>
        <input id="hire-name" placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit">Hire</button>
      </form>
    </section>
  );
}
