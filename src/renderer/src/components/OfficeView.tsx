import { useEffect, useState } from 'react';
import type { Agent, Role, WorkspaceSnapshot } from '../../../shared/types';
import { SLOT_MS, planFloor, type CafeSpot } from '../office/floor';
import { progress, statusCounts } from '../office/model';
import { DeskSprite } from '../sprites/DeskSprite';
import { PersonSprite } from '../sprites/PersonSprite';
import { clip, lookFor } from '../sprites/sprite';

function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), everyMs); return () => clearInterval(id); }, [everyMs]);
  return now;
}

interface Props { ws: WorkspaceSnapshot; roles: Role[]; onOpenAgent: (id: string) => void; onHire: () => void }

export function OfficeView({ ws, roles, onOpenAgent, onHire }: Props) {
  const now = useNow(15_000);
  const plan = planFloor(ws.agents, ws.tasks, Math.floor(now / SLOT_MS));
  const counts = statusCounts([...(plan.boss ? [plan.boss.state] : []), ...plan.desks.map((d) => d.state)]);
  const prog = progress(ws.tasks);
  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? id;
  const clock = new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const where = (id: string) => (plan.washroom?.agent.id === id ? 'In the washroom' : 'At the cafeteria');
  const onBreak = plan.cafeteria.length + (plan.washroom ? 1 : 0);

  return (
    <section className="office" aria-label="Office">
      <div className="status-strip small muted">
        <span className="item"><span className="dot" style={{ background: 'var(--teal)' }} />{counts.working} working</span>
        <span className="item"><span className="dot" style={{ background: 'var(--amber)' }} />{counts.thinking} thinking</span>
        <span className="item"><span className="dot" style={{ background: 'var(--blue)' }} />{counts.waiting} waiting</span>
        <span className="item"><span className="dot" style={{ background: 'var(--red)' }} />{counts.problem} need help</span>
        <span className="item"><span className="dot" style={{ background: '#C9935C' }} />{onBreak} on a break</span>
        <span className="progress mono">tasks {prog.done}/{prog.total} done · up to {ws.project.maxConcurrent} at once</span>
      </div>

      <div className="floor">
        <div className="wall" aria-hidden="true">
          <div className="window" /><div className="window" /><div className="window" />
          <span className="clock">{clock}</span>
          <div className="plant" />
        </div>

        <div className="rooms">
          <div className="room work-area" aria-label="Work area">
            <span className="room-tag">OPEN OFFICE</span>
            <div className="desks">
              {plan.boss && (
                <div className="boss-spot">
                  <span className="room-tag boss-tag">BOSS</span>
                  <DeskSprite compact name={plan.boss.agent.name} role="Boss" look={lookFor(plan.boss.agent, roles)} status={plan.boss.state.status} bubble={plan.boss.state.bubble} onClick={() => onOpenAgent(plan.boss!.agent.id)} />
                </div>
              )}
              {plan.desks.map((d) => (
                <DeskSprite key={d.agent.id} compact away={d.away} name={d.agent.name} role={roleName(d.agent.roleId)} look={lookFor(d.agent, roles)}
                  status={d.away ? 'idle' : d.state.status} bubble={d.away ? where(d.agent.id) : d.state.bubble} onClick={() => onOpenAgent(d.agent.id)} />
              ))}
              <button type="button" className="empty-desk compact" onClick={onHire}>
                <svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M8 2v12M2 8h12" /></svg>
                Empty desk · hire
              </button>
            </div>
          </div>

          <div className="side-rooms">
            <Cafeteria people={plan.cafeteria} roles={roles} roleName={roleName} onOpenAgent={onOpenAgent} />
            <Washroom occupant={plan.washroom?.agent} roles={roles} roleName={roleName} onOpenAgent={onOpenAgent} />
          </div>
        </div>
      </div>
    </section>
  );
}

interface RoomProps { roles: Role[]; roleName: (id: string) => string; onOpenAgent: (id: string) => void }

function Cafeteria({ people, roles, roleName, onOpenAgent }: RoomProps & { people: CafeSpot[] }) {
  // Chatting pairs face each other, so keep them next to each other.
  const ordered = [...people.filter((p) => p.activity === 'chat'), ...people.filter((p) => p.activity !== 'chat')];
  return (
    <div className="room cafeteria" aria-label="Cafeteria">
      <span className="room-tag">CAFETERIA</span>
      <div className="cafe-counter" aria-hidden="true">
        <svg viewBox="0 0 60 22" width="180" height="66" shapeRendering="crispEdges">
          <rect x="0" y="12" width="60" height="10" fill="#8B5A34" />
          <rect x="0" y="12" width="60" height="2" fill="#C9935C" />
          <rect x="4" y="2" width="10" height="10" fill="#2A2E40" />
          <rect x="6" y="4" width="6" height="2" fill="#FF7A6B" />
          <rect x="8" y="8" width="2" height="2" fill="#ECE8DF" />
          <rect x="18" y="8" width="3" height="4" fill="#ECE8DF" />
          <rect x="23" y="8" width="3" height="4" fill="#52D1BE" />
          <rect x="30" y="6" width="8" height="6" fill="#DDA872" />
          <rect x="31" y="7" width="6" height="1" fill="#8BD47A" />
          <rect x="44" y="0" width="14" height="22" fill="#D8D2C4" />
          <rect x="44" y="9" width="14" height="1" fill="#A3A6B8" />
          <rect x="55" y="3" width="1" height="4" fill="#6E7288" />
          <rect x="55" y="12" width="1" height="5" fill="#6E7288" />
        </svg>
      </div>
      <div className="cafe-floor">
        {ordered.length === 0 ? <span className="small room-empty">Quiet right now</span> : (
          <>
            <div className="cafe-side left">{ordered.filter((_, i) => i % 2 === 0).map((p) => <Person key={p.agent.id} p={p} flip={false} roles={roles} roleName={roleName} onOpenAgent={onOpenAgent} />)}</div>
            <div className="cafe-table" aria-hidden="true" />
            <div className="cafe-side right">{ordered.filter((_, i) => i % 2 === 1).map((p) => <Person key={p.agent.id} p={p} flip roles={roles} roleName={roleName} onOpenAgent={onOpenAgent} />)}</div>
          </>
        )}
      </div>
    </div>
  );
}

function Person({ p, flip, roles, roleName, onOpenAgent }: RoomProps & { p: CafeSpot; flip: boolean }) {
  return (
    <button type="button" className="person-spot" onClick={() => onOpenAgent(p.agent.id)} aria-label={`${p.agent.name}, ${roleName(p.agent.roleId)}: ${p.label}`}>
      <span className="person-bubble">{p.activity === 'chat' ? 'Chatting' : p.label}</span>
      <PersonSprite look={lookFor(p.agent, roles)} pose={p.activity} flip={flip} />
      <span className="person-name">{clip(p.agent.name, 12)}</span>
    </button>
  );
}

function Washroom({ occupant, roles, roleName, onOpenAgent }: RoomProps & { occupant: Agent | undefined }) {
  return (
    <div className="room washroom" aria-label="Washroom">
      <span className="room-tag">WASHROOM</span>
      <div className="washroom-inner">
        <div className="wash-decor" aria-hidden="true">
          <svg viewBox="0 0 20 24" width="60" height="72" shapeRendering="crispEdges">
            <rect x="4" y="0" width="12" height="9" fill="#9AA0B8" />
            <rect x="5" y="1" width="10" height="7" fill="#C8DDF2" />
            <rect x="2" y="12" width="16" height="4" fill="#ECE8DF" />
            <rect x="9" y="10" width="2" height="2" fill="#A3A6B8" />
            <rect x="8" y="16" width="4" height="8" fill="#D8D2C4" />
          </svg>
        </div>
        {occupant ? (
          <button type="button" className="wash-door occupied" onClick={() => onOpenAgent(occupant.id)} aria-label={`${occupant.name}, ${roleName(occupant.roleId)}: In the washroom`}>
            <span className="door-sign">Occupied</span>
            <span className="door-who">{clip(occupant.name, 12)}</span>
            <span className="door-avatar" aria-hidden="true"><span style={{ background: lookFor(occupant, roles).shirt }} /></span>
          </button>
        ) : (
          <div className="wash-door" aria-label="Washroom door: vacant" role="img">
            <span className="door-sign vacant">Vacant</span>
          </div>
        )}
      </div>
    </div>
  );
}
