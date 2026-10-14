import { useEffect, useState } from 'react';
import type { Agent, Role, WorkspaceSnapshot } from '../../../shared/types';
import { SLOT_MS, planFloor, type CafeSpot, type PlaySpot } from '../office/floor';
import { progress, statusCounts } from '../office/model';
import { DeskSprite } from '../sprites/DeskSprite';
import { PersonSprite } from '../sprites/PersonSprite';
import { clip, lookFor } from '../sprites/sprite';

function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), everyMs); return () => clearInterval(id); }, [everyMs]);
  return now;
}

interface Props { ws: WorkspaceSnapshot; roles: Role[]; onOpenAgent: (id: string) => void }

export function OfficeView({ ws, roles, onOpenAgent }: Props) {
  const now = useNow(15_000);
  const plan = planFloor(ws.agents, ws.tasks, Math.floor(now / SLOT_MS));
  const counts = statusCounts([...(plan.boss ? [plan.boss.state] : []), ...plan.desks.map((d) => d.state)]);
  const prog = progress(ws.tasks);
  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? id;
  const clock = new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const where = (id: string) => (plan.washroom?.agent.id === id ? 'In the washroom' : plan.play.some((p) => p.agent.id === id) ? 'In the play area' : 'At the cafeteria');
  const onBreak = plan.cafeteria.length + plan.play.length + (plan.washroom ? 1 : 0);

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
          <div className="main-rooms">
            <div className="room work-area" aria-label="Work area">
              <span className="room-tag">OPEN OFFICE</span>
              <div className="desks">
                {plan.boss && (
                  <div className="boss-spot">
                    <DeskSprite compact name={plan.boss.agent.name} role="Boss" look={lookFor(plan.boss.agent, roles)} status={plan.boss.state.status} bubble={plan.boss.state.bubble} onClick={() => onOpenAgent(plan.boss!.agent.id)} />
                  </div>
                )}
                {plan.desks.map((d) => (
                  <DeskSprite key={d.agent.id} compact away={d.away} name={d.agent.name} role={roleName(d.agent.roleId)} look={lookFor(d.agent, roles)}
                    status={d.away ? 'idle' : d.state.status} bubble={d.away ? where(d.agent.id) : d.idle?.label ?? d.state.bubble} idle={d.idle?.action} onClick={() => onOpenAgent(d.agent.id)} />
                ))}
              </div>
            </div>
            <PlayArea people={plan.play} roles={roles} roleName={roleName} onOpenAgent={onOpenAgent} />
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

const BUBBLE: Record<PlaySpot['activity'], string> = { pingpong: 'Ping-pong', arcade: 'High score!', gaming: 'Gaming', nap: 'z z Z' };

function Player({ p, flip, roles, roleName, onOpenAgent }: RoomProps & { p: PlaySpot; flip?: boolean }) {
  return (
    <button type="button" className={`person-spot play-${p.activity}`} onClick={() => onOpenAgent(p.agent.id)} aria-label={`${p.agent.name}, ${roleName(p.agent.roleId)}: ${p.label}`}>
      {p.activity === 'nap' ? (
        // Napping on the couch: the name rides in the bubble so the sprite can lie on the cushion.
        <span className="person-bubble zzz">{BUBBLE.nap} {clip(p.agent.name, 10)}</span>
      ) : <span className="person-bubble">{BUBBLE[p.activity]}</span>}
      <PersonSprite look={lookFor(p.agent, roles)} pose={p.activity} flip={flip} />
      {p.activity !== 'nap' && <span className="person-name">{clip(p.agent.name, 12)}</span>}
    </button>
  );
}

function PlayArea({ people, roles, roleName, onOpenAgent }: RoomProps & { people: PlaySpot[] }) {
  const who = (a: PlaySpot['activity']) => people.filter((p) => p.activity === a);
  const pong = who('pingpong');
  const props = { roles, roleName, onOpenAgent };
  return (
    <div className="room play-area" aria-label="Play area">
      <span className="room-tag">PLAY AREA</span>
      {people.length === 0 && <span className="small room-empty play-empty">Nobody's playing</span>}
      <div className="play-zones">
        <div className="play-zone pong">
          <div className="play-people">{pong.filter((_, i) => i % 2 === 0).map((p) => <Player key={p.agent.id} p={p} {...props} />)}</div>
          <svg className="play-prop" viewBox="0 0 40 20" width="120" height="60" shapeRendering="crispEdges" aria-hidden="true">
            <rect x="2" y="16" width="2" height="4" fill="#2A2D42" /><rect x="36" y="16" width="2" height="4" fill="#2A2D42" />
            <rect x="0" y="6" width="40" height="10" fill="#2F9E8F" />
            <rect x="0" y="6" width="40" height="1" fill="#52D1BE" />
            <rect x="19" y="2" width="2" height="14" fill="#ECE8DF" />
            <rect x="0" y="10" width="40" height="1" fill="#ECE8DF" opacity="0.6" />
            {pong.length > 0 && <rect className="pong-ball" x="8" y="3" width="2" height="2" fill="#FFF4D6" />}
          </svg>
          <div className="play-people">{pong.filter((_, i) => i % 2 === 1).map((p) => <Player key={p.agent.id} p={p} flip {...props} />)}</div>
        </div>
        <div className="play-zone arcade">
          <svg className="play-prop" viewBox="0 0 16 30" width="48" height="90" shapeRendering="crispEdges" aria-hidden="true">
            <rect x="1" y="0" width="14" height="30" fill="#6D4AFF" />
            <rect x="1" y="0" width="14" height="3" fill="#FF6B5B" />
            <rect x="3" y="5" width="10" height="8" fill="#1A1A2E" />
            <rect className={who('arcade').length > 0 ? 'arcade-screen on' : 'arcade-screen'} x="4" y="6" width="8" height="6" fill="#4BE3B0" />
            <rect x="2" y="15" width="12" height="4" fill="#2A2D42" />
            <rect x="4" y="16" width="1" height="2" fill="#FF6B5B" /><rect x="9" y="16" width="2" height="2" fill="#F5B942" />
            <rect x="3" y="21" width="10" height="9" fill="#5B3DD6" />
          </svg>
          <div className="play-people">{who('arcade').map((p) => <Player key={p.agent.id} p={p} flip {...props} />)}</div>
        </div>
        <div className="play-zone gaming">
          <svg className="play-prop" viewBox="0 0 30 18" width="90" height="54" shapeRendering="crispEdges" aria-hidden="true">
            <rect x="4" y="0" width="22" height="13" fill="#1A1A2E" />
            <rect x="5" y="1" width="20" height="11" fill={who('gaming').length > 0 ? '#7AA2FF' : '#2A2D42'} />
            <rect x="13" y="13" width="4" height="2" fill="#1A1A2E" />
            <rect x="8" y="15" width="14" height="3" fill="#8B5A34" />
          </svg>
          <div className="play-people">{who('gaming').map((p) => <Player key={p.agent.id} p={p} flip {...props} />)}</div>
        </div>
        <div className="play-zone nap">
          <div className="nap-couch">
            <div className="play-people">{who('nap').map((p) => <Player key={p.agent.id} p={p} {...props} />)}</div>
            <svg className="play-prop" viewBox="0 0 44 12" width="132" height="36" shapeRendering="crispEdges" aria-hidden="true">
              <rect x="0" y="0" width="4" height="10" fill="#4A3D7A" /><rect x="40" y="0" width="4" height="10" fill="#4A3D7A" />
              <rect x="2" y="3" width="40" height="7" fill="#6D5BB0" />
              <rect x="2" y="3" width="40" height="1" fill="#8D7BD0" />
              <rect x="3" y="10" width="2" height="2" fill="#2A2D42" /><rect x="39" y="10" width="2" height="2" fill="#2A2D42" />
            </svg>
          </div>
          <svg className="play-prop lamp" viewBox="0 0 8 20" width="24" height="60" shapeRendering="crispEdges" aria-hidden="true">
            <rect x="1" y="0" width="6" height="4" fill="#F5B942" />
            <rect x="3" y="4" width="2" height="14" fill="#8A90B0" />
            <rect x="1" y="18" width="6" height="2" fill="#2A2D42" />
          </svg>
        </div>
      </div>
    </div>
  );
}
