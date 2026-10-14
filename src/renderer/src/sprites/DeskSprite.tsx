import type { AgentStatus, Look } from '../../../shared/types';
import { STATUS_COLORS, STATUS_LABEL, clip, spriteClass } from './sprite';

interface Props { name: string; role: string; look: Look; status: AgentStatus; bubble: string; onClick?: () => void; selected?: boolean }

export function DeskSprite({ name, role, look, status, bubble, onClick, selected }: Props) {
  const c = STATUS_COLORS[status];
  const body = (
    <>
      <span className="desk-bubble" title={bubble}>{clip(bubble, 34)}</span>
      <svg className={spriteClass(status)} viewBox="0 0 48 44" width="192" height="176" shapeRendering="crispEdges" aria-hidden="true">
        <rect x="4" y="40" width="40" height="3" fill="#000000" opacity="0.28" />
        <rect x="25" y="13" width="16" height="15" fill="#3A3F58" />
        <rect x="25" y="13" width="16" height="2" fill="#4A5070" />
        <g className="ao-body">
          <rect x="27" y="17" width="12" height="10" fill={look.shirt} />
          <rect x="31" y="17" width="4" height="2" fill={look.skin} />
          <g className="ao-head">
            <rect x="29" y="8" width="8" height="9" fill={look.skin} />
            <rect x="28" y="6" width="10" height="3" fill={look.hair} />
            <rect x="28" y="9" width="2" height="4" fill={look.hair} />
            <rect x="36" y="9" width="2" height="2" fill={look.hair} />
            <rect x="31" y="12" width="1" height="2" fill="#1B1B24" />
            <rect x="34" y="12" width="1" height="2" fill="#1B1B24" />
            <rect x="32" y="15" width="2" height="1" fill="#9A5A4A" />
          </g>
        </g>
        <g className="ao-armL">
          <rect x="25" y="19" width="3" height="7" fill={look.shirt} />
          <rect x="25" y="25" width="3" height="2" fill={look.skin} />
        </g>
        <g className="ao-armR">
          <rect x="38" y="19" width="3" height="7" fill={look.shirt} />
          <rect x="38" y="25" width="3" height="2" fill={look.skin} />
        </g>
        <rect x="4" y="9" width="18" height="14" fill="#2A2E40" />
        <rect className="ao-screen" x="5" y="10" width="16" height="11" fill={c.screen} />
        <g className="ao-code" fill={c.ink}>
          <rect x="6" y="11" width="7" height="1" />
          <rect x="6" y="13" width="11" height="1" />
          <rect x="8" y="15" width="8" height="1" />
          <rect x="8" y="17" width="5" height="1" />
          <rect x="6" y="19" width="9" height="1" />
        </g>
        <rect x="11" y="23" width="4" height="4" fill="#2A2E40" />
        <rect x="1" y="27" width="46" height="3" fill="#C9935C" />
        <rect x="1" y="27" width="46" height="1" fill="#DDA872" />
        <rect x="27" y="26" width="12" height="1" fill="#D8D2C4" />
        <rect x="42" y="23" width="3" height="4" fill="#ECE8DF" />
        <rect x="45" y="24" width="1" height="2" fill="#ECE8DF" />
        <rect x="3" y="30" width="42" height="10" fill="#8B5A34" />
        <rect x="3" y="30" width="42" height="1" fill="#6B4224" />
        <rect x="30" y="33" width="12" height="4" fill="#7A4D2B" />
        <rect x="35" y="35" width="2" height="1" fill="#C9935C" />
      </svg>
      <span className="desk-plate">
        <span className="dot" style={{ background: c.dot }} aria-hidden="true" />
        <span className="desk-name">{clip(name, 16)}</span>
        <span className="desk-role">{clip(role, 18)}</span>
      </span>
    </>
  );
  const label = `${name}, ${role}: ${STATUS_LABEL[status]}. ${bubble}`;
  return onClick ? (
    <button type="button" className={selected ? 'desk selected' : 'desk'} onClick={onClick} aria-label={label}>{body}</button>
  ) : (
    <div className="desk" role="img" aria-label={label}>{body}</div>
  );
}
