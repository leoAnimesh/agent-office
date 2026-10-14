import { useEffect, useState } from 'react';
import type { Role, Skill, WorkspaceSnapshot } from '../../../shared/types';
import { Avatar } from '../sprites/Avatar';
import { STATUS_LABEL, lookFor } from '../sprites/sprite';
import { blankRole } from '../team/roleForm';
import { MenuButton } from './MenuButton';
import { RoleEditor } from './RoleEditor';

interface Props { ws: WorkspaceSnapshot; roles: Role[]; onRolesChanged: () => void; onOpenAgent: (id: string) => void; onError: (m: string) => void }

export function TeamView({ ws, roles, onRolesChanged, onOpenAgent, onError }: Props) {
  const [selected, setSelected] = useState<string>('frontend');
  const [creating, setCreating] = useState(false);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [confirmFire, setConfirmFire] = useState<string | null>(null);
  const loadSkills = () => { window.agentOffice.listSkills().then(setSkills, () => setSkills([])); };
  useEffect(loadSkills, []);

  const library = roles.filter((r) => r.id !== 'boss');
  const current = creating ? null : roles.find((r) => r.id === selected) ?? library[0];
  const fire = async (id: string) => {
    try { await window.agentOffice.fireAgent(id); } catch (e) { onError(String(e)); } finally { setConfirmFire(null); }
  };

  return (
    <div className="team-layout">
      <div className="team-col">
        <section aria-label="Role library" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="row"><h2 style={{ margin: 0, fontSize: 16 }}>Role library</h2><span className="small muted">Pick a role to edit, then hire</span></div>
          <div className="role-grid">
            {library.map((r) => (
              <button key={r.id} type="button" className="role-card" aria-pressed={!creating && current?.id === r.id} onClick={() => { setCreating(false); setSelected(r.id); }}>
                <Avatar look={r.look} size={36} />
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <span style={{ fontWeight: 600 }}>{r.name}</span>
                  <span className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.blurb}</span>
                </span>
              </button>
            ))}
            <button type="button" className="role-card" aria-pressed={creating} onClick={() => setCreating(true)}>
              <span className="pixel" style={{ fontSize: 22, width: 36, textAlign: 'center' }} aria-hidden="true">+</span>
              <span style={{ fontWeight: 600 }}>New role</span>
            </button>
          </div>
        </section>
        <section aria-label="Current team" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>On the team <span className="muted" style={{ fontWeight: 400 }}>· {ws.agents.length}</span></h2>
          {ws.agents.map((a) => {
            const role = roles.find((r) => r.id === a.roleId);
            const roleLabel = a.kind === 'boss' ? 'Boss' : role?.name ?? a.roleId;
            return (
              <div key={a.id} className="team-row">
                <Avatar look={lookFor(a, roles)} size={32} />
                {/* One line per row: details shrink with "…" so the menu never wraps below. */}
                <span className="team-info" title={`${a.name} · ${roleLabel} · ${role?.model ?? ''} · ${STATUS_LABEL[a.status]}`}>
                  <span className="team-name">{a.name}</span>
                  <span className="small muted">{roleLabel}</span>
                  <span className="mono small muted">{role?.model}</span>
                  <span className="small muted">{STATUS_LABEL[a.status]}</span>
                </span>
                <span className="team-actions">
                  {confirmFire === a.id && <><button type="button" className="btn small danger" onClick={() => void fire(a.id)}>Confirm fire</button><button type="button" className="btn small" onClick={() => setConfirmFire(null)}>Keep</button></>}
                  <MenuButton label={`Options for ${a.name}`} items={[
                    { label: 'Open details', onSelect: () => onOpenAgent(a.id) },
                    ...(a.kind === 'employee' ? [{ label: 'Fire…', danger: true, onSelect: () => setConfirmFire(a.id) }] : []),
                  ]} />
                </span>
              </div>
            );
          })}
        </section>
      </div>
      {creating ? (
        <RoleEditor role={blankRole()} isNew takenIds={roles.map((r) => r.id)} skills={skills} onSaved={(r) => { setCreating(false); setSelected(r.id); onRolesChanged(); }} onSkillsChanged={loadSkills} onError={onError} />
      ) : current ? (
        <RoleEditor role={current} isNew={false} takenIds={roles.map((r) => r.id)} skills={skills} onSaved={() => onRolesChanged()} onSkillsChanged={loadSkills} onError={onError} />
      ) : null}
    </div>
  );
}
