import { useState } from 'react';
import type { Role, WorkspaceSnapshot } from '../../../shared/types';
import { Avatar } from '../sprites/Avatar';
import { lookFor } from '../sprites/sprite';
import { MenuButton } from './MenuButton';

interface Props { ws: WorkspaceSnapshot; roles: Role[]; onOpenAgent: (id: string) => void; onError: (m: string) => void }

/** The team. Hiring and roles go through the boss chat (hire, create_role, update_role). */
export function TeamView({ ws, roles, onOpenAgent, onError }: Props) {
  const [confirmFire, setConfirmFire] = useState<string | null>(null);
  const fire = async (id: string) => {
    try { await window.agentOffice.fireAgent(id); } catch (e) { onError(String(e)); } finally { setConfirmFire(null); }
  };

  return (
    <div className="team-col team-only">
      <section aria-label="Current team" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>On the team <span className="muted" style={{ fontWeight: 400 }}>· {ws.agents.length}</span></h2>
        {ws.agents.map((a) => {
          const role = roles.find((r) => r.id === a.roleId);
          const roleLabel = a.kind === 'boss' ? 'Boss' : role?.name ?? a.roleId;
          return (
            <div key={a.id} className="team-row">
              <Avatar look={lookFor(a, roles)} size={32} />
              {/* One line per row: details shrink with "…" so the menu never wraps below. */}
              <span className="team-info" title={`${a.name} · ${roleLabel}`}>
                <span className="team-name">{a.name}</span>
                <span className="small muted">{roleLabel}</span>
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
        <p className="small muted" style={{ margin: 0 }}>To hire someone, or to create or change a role, ask the boss in the chat.</p>
    </div>
  );
}
