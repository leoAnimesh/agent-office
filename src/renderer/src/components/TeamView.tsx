import { useState } from 'react';
import type { Agent, Role, WorkspaceSnapshot } from '../../../shared/types';
import { Avatar } from '../sprites/Avatar';
import { STATUS_COLORS, clip, lookFor } from '../sprites/sprite';
import { teamCard, teamSummary } from '../team/cards';
import { MenuButton } from './MenuButton';
import { ProjectSkillsPanel } from './ProjectSkillsPanel';

interface Props { ws: WorkspaceSnapshot; roles: Role[]; onOpenAgent: (id: string) => void; onError: (m: string) => void }

/** The team as cards. Hiring and roles go through the boss chat (hire, create_role, update_role). */
export function TeamView({ ws, roles, onOpenAgent, onError }: Props) {
  const [confirmFire, setConfirmFire] = useState<string | null>(null);
  const fire = async (id: string) => {
    try { await window.agentOffice.fireAgent(id); } catch (e) { onError(String(e)); } finally { setConfirmFire(null); }
  };
  const boss = ws.agents.find((a) => a.kind === 'boss');
  const employees = ws.agents.filter((a) => a.kind === 'employee');

  /** The boss leads the page: who they are, plus what the whole team is doing right now. */
  const bossRow = (a: Agent) => {
    const role = roles.find((r) => r.id === a.roleId);
    const c = teamCard(a, ws.tasks, role);
    const sum = teamSummary(ws.agents, ws.tasks);
    const tiles: { label: string; n: number; color: string }[] = [
      { label: 'working', n: sum.working, color: 'var(--teal)' },
      { label: 'need help', n: sum.needsHelp, color: 'var(--red)' },
      { label: 'in review', n: sum.review, color: 'var(--amber)' },
      { label: 'queued', n: sum.queued, color: 'var(--blue)' },
      { label: 'merged', n: sum.merged, color: 'var(--green)' },
    ];
    return (
      <article className="boss-card" onClick={() => onOpenAgent(a.id)}>
        <Avatar look={lookFor(a, roles)} size={56} />
        <div className="boss-id">
          <button type="button" className="team-open" onClick={(e) => { e.stopPropagation(); onOpenAgent(a.id); }}>{a.name}</button>
          <span className="small muted">Boss · <span className="mono">{c.model}</span></span>
          <span className="status-pill"><span className="dot" style={{ background: STATUS_COLORS[c.status].dot }} aria-hidden="true" />{c.label}</span>
        </div>
        <ul className="boss-stats" aria-label="The team right now">
          {tiles.map((t) => (
            <li key={t.label} className={t.n === 0 ? 'boss-stat zero' : 'boss-stat'}>
              <span className="boss-stat-n" style={t.n ? { color: t.color } : undefined}>{t.n}</span>
              <span className="small muted">{t.label}</span>
            </li>
          ))}
        </ul>
        <div className="team-card-menu" onClick={(e) => e.stopPropagation()}>
          <MenuButton label={`Options for ${a.name}`} items={[{ label: 'Open details', onSelect: () => onOpenAgent(a.id) }]} />
        </div>
      </article>
    );
  };

  const card = (a: Agent) => {
    const role = roles.find((r) => r.id === a.roleId);
    const c = teamCard(a, ws.tasks, role);
    const roleLabel = a.kind === 'boss' ? 'Boss' : role?.name ?? a.roleId;
    return (
      // The name button is the keyboard way in; a click anywhere else on the card does the same.
      <article key={a.id} className="team-card" onClick={() => onOpenAgent(a.id)}>
        <div className="team-card-top">
          <Avatar look={lookFor(a, roles)} size={48} />
          <div className="team-card-id">
            <button type="button" className="team-open" onClick={(e) => { e.stopPropagation(); onOpenAgent(a.id); }}>{a.name}</button>
            <span className="small muted">{roleLabel}</span>
          </div>
          <div className="team-card-menu" onClick={(e) => e.stopPropagation()}>
            <MenuButton label={`Options for ${a.name}`} items={[
              { label: 'Open details', onSelect: () => onOpenAgent(a.id) },
              ...(a.kind === 'employee' ? [{ label: 'Fire…', danger: true, onSelect: () => setConfirmFire(a.id) }] : []),
            ]} />
          </div>
        </div>
        <div className="team-status">
          <span className="status-pill"><span className="dot" style={{ background: STATUS_COLORS[c.status].dot }} aria-hidden="true" />{c.label}</span>
          {/* Live activity only; other states are already told by the task line below. */}
          {(c.status === 'working' || c.status === 'thinking') && c.bubble && c.bubble !== c.label && <span className="small muted team-bubble" title={c.bubble}>{clip(c.bubble, 60)}</span>}
        </div>
        <div className="team-task small" title={c.task?.title}>
          {c.task ? <><span className="chip">{c.task.id}</span> <span className="team-task-title">{c.task.title}</span></> : <span className="muted">{a.kind === 'boss' ? 'Plans, delegates and reviews' : 'No task right now'}</span>}
        </div>
        <div className="team-foot mono small muted">
          {c.model && <span>{c.model}</span>}
          {a.kind === 'employee' && <span>{c.done} done</span>}
        </div>
        {confirmFire === a.id && (
          <div className="card-confirm" role="group" aria-label={`Fire ${a.name}?`} onClick={(e) => e.stopPropagation()}>
            <span className="small">Fire {a.name}?</span>
            <button type="button" className="btn small danger" onClick={() => void fire(a.id)}>Confirm fire</button>
            <button type="button" className="btn small" onClick={() => setConfirmFire(null)}>Keep</button>
          </div>
        )}
      </article>
    );
  };

  return (
    <div className="team">
      <div className="team-head">
        <h2>Team <span className="muted" style={{ fontWeight: 400 }}>· {ws.agents.length}</span></h2>
        <p className="small muted" style={{ margin: 0 }}>To hire someone, or to create or change a role, ask the boss in the chat.</p>
      </div>
      <section aria-label="Current team" className="team-sections">
        {boss && bossRow(boss)}
        <ProjectSkillsPanel project={ws.project} onError={onError} />
        {employees.length > 0
          ? <div className="team-grid">{employees.map((a) => card(a))}</div>
          : <p className="small muted">No one is hired yet. Ask the boss to hire someone for the work you have in mind.</p>}
      </section>
    </div>
  );
}
