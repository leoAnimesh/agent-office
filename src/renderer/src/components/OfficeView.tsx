import { useEffect, useState } from 'react';
import type { Role, WorkspaceSnapshot } from '../../../shared/types';
import { displayState, progress, splitTeam, statusCounts, whiteboard } from '../office/model';
import { DeskSprite } from '../sprites/DeskSprite';
import { lookFor } from '../sprites/sprite';

function useClock(): string {
  const fmt = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const [t, setT] = useState(fmt);
  useEffect(() => { const id = setInterval(() => setT(fmt()), 30_000); return () => clearInterval(id); }, []);
  return t;
}

export function OfficeView({ ws, roles, onOpenAgent, onHire }: { ws: WorkspaceSnapshot; roles: Role[]; onOpenAgent: (id: string) => void; onHire: () => void }) {
  const clock = useClock();
  const { boss, employees } = splitTeam(ws.agents);
  const states = new Map(ws.agents.map((a) => [a.id, displayState(a, ws.tasks)]));
  const counts = statusCounts([...states.values()]);
  const prog = progress(ws.tasks);
  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? id;

  return (
    <section aria-label="Office">
      <div className="status-strip small muted">
        <span className="item"><span className="dot" style={{ background: 'var(--teal)' }} />{counts.working} working</span>
        <span className="item"><span className="dot" style={{ background: 'var(--amber)' }} />{counts.thinking} thinking</span>
        <span className="item"><span className="dot" style={{ background: 'var(--blue)' }} />{counts.waiting} waiting</span>
        <span className="item"><span className="dot" style={{ background: 'var(--red)' }} />{counts.problem} need help</span>
        <span className="progress mono">tasks {prog.done}/{prog.total} done · up to {ws.project.maxConcurrent} at once</span>
      </div>
      <div className="floor">
        <div className="wall" aria-hidden="true">
          <div className="window" /><div className="window" />
          <span className="clock">{clock}</span>
          <div className="plant" />
        </div>
        <div className="corner-office">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="tag">CORNER OFFICE</span>
            {boss && (() => { const st = states.get(boss.id)!; return <DeskSprite name={boss.name} role="Boss" look={lookFor(boss, roles)} status={st.status} bubble={st.bubble} onClick={() => onOpenAgent(boss.id)} />; })()}
          </div>
          <div className="whiteboard" aria-label="Plan">
            <h3>Plan</h3>
            {whiteboard(ws.tasks, ws.agents).map((l, i) => (
              <div key={i} className="line"><span className={`mark tone-${l.tone}`}>{l.mark}</span><span>{l.text}</span></div>
            ))}
            {ws.tasks.length === 0 && <div className="line tone-todo">No tasks yet. Tell the boss what to build.</div>}
          </div>
        </div>
        <div className="desks">
          {employees.map((a) => {
            const st = states.get(a.id)!;
            return <DeskSprite key={a.id} name={a.name} role={roleName(a.roleId)} look={lookFor(a, roles)} status={st.status} bubble={st.bubble} onClick={() => onOpenAgent(a.id)} />;
          })}
          <button type="button" className="empty-desk" onClick={onHire}>
            <svg width="28" height="28" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M8 2v12M2 8h12" /></svg>
            Empty desk · hire
          </button>
        </div>
      </div>
    </section>
  );
}
