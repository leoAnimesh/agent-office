import type { Look } from '../../../shared/types';

export function Avatar({ look, size = 32, label }: { look: Look; size?: number; label?: string }) {
  return (
    <svg viewBox="0 0 12 12" width={size} height={size} shapeRendering="crispEdges" className="avatar" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <rect x="0" y="0" width="12" height="12" fill="#2A2D40" />
      <rect x="2" y="9" width="8" height="3" fill={look.shirt} />
      <rect x="3" y="2" width="6" height="7" fill={look.skin} />
      <rect x="3" y="1" width="6" height="2" fill={look.hair} />
      <rect x="2" y="2" width="1" height="3" fill={look.hair} />
      <rect x="9" y="2" width="1" height="2" fill={look.hair} />
      <rect x="4" y="5" width="1" height="1" fill="#1B1B24" />
      <rect x="7" y="5" width="1" height="1" fill="#1B1B24" />
    </svg>
  );
}
