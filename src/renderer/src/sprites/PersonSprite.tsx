import type { Look } from '../../../shared/types';

export type PersonPose = 'coffee' | 'snack' | 'chat' | 'pingpong' | 'arcade' | 'gaming' | 'nap';

/** A small figure for the cafeteria, washroom and play area. Purely decorative (the button around it is labelled). */
export function PersonSprite({ look, pose, flip }: { look: Look; pose: PersonPose; flip?: boolean }) {
  if (pose === 'nap') return <Napper look={look} flip={flip} />;
  if (pose === 'gaming') return <Gamer look={look} flip={flip} />;
  return (
    <svg className={`person act-${pose}`} viewBox="0 0 14 22" width="42" height="66" shapeRendering="crispEdges" aria-hidden="true" style={flip ? { transform: 'scaleX(-1)' } : undefined}>
      <rect x="3" y="21" width="9" height="1" fill="#000000" opacity="0.25" />
      <g className="p-body">
        <rect x="4" y="14" width="2" height="6" fill="#2A2E40" />
        <rect x="8" y="14" width="2" height="6" fill="#2A2E40" />
        <rect x="3" y="20" width="3" height="1" fill="#14151F" />
        <rect x="8" y="20" width="3" height="1" fill="#14151F" />
        <rect x="3" y="7" width="8" height="7" fill={look.shirt} />
        <rect x="4" y="2" width="6" height="5" fill={look.skin} />
        <rect x="4" y="0" width="6" height="2" fill={look.hair} />
        <rect x="3" y="1" width="1" height="3" fill={look.hair} />
        <rect x="10" y="1" width="1" height="2" fill={look.hair} />
        <rect x="5" y="4" width="1" height="1" fill="#1B1B24" />
        <rect x="8" y="4" width="1" height="1" fill="#1B1B24" />
        <g className="p-arm-left">
          <rect x="1" y="8" width="2" height="5" fill={look.shirt} />
          <rect x="1" y="13" width="2" height="1" fill={look.skin} />
        </g>
        <rect x="11" y="8" width="2" height="4" fill={look.shirt} />
        <rect x="11" y="12" width="2" height="1" fill={look.skin} />
        <g className="p-item">
          {pose === 'coffee' && (
            <>
              <rect x="12" y="10" width="2" height="2" fill="#ECE8DF" />
              <rect x="12" y="10" width="2" height="1" fill="#6B4224" />
            </>
          )}
          {pose === 'snack' && (
            <>
              <rect x="11" y="10" width="3" height="1" fill="#DDA872" />
              <rect x="11" y="11" width="3" height="1" fill="#8BD47A" />
              <rect x="11" y="12" width="3" height="1" fill="#DDA872" />
            </>
          )}
          {pose === 'pingpong' && (
            <>
              <rect x="12" y="8" width="2" height="3" fill="#FF6B5B" />
              <rect x="12" y="11" width="1" height="2" fill="#8B5A34" />
            </>
          )}
        </g>
      </g>
    </svg>
  );
}

/** Sitting on a bean bag with a controller. */
function Gamer({ look, flip }: { look: Look; flip?: boolean }) {
  return (
    <svg className="person act-gaming" viewBox="0 0 14 22" width="42" height="66" shapeRendering="crispEdges" aria-hidden="true" style={flip ? { transform: 'scaleX(-1)' } : undefined}>
      <rect x="0" y="21" width="14" height="1" fill="#000000" opacity="0.25" />
      <rect x="0" y="15" width="11" height="6" fill="#FF6B5B" />
      <rect x="1" y="14" width="9" height="1" fill="#FF8A7D" />
      <rect x="0" y="12" width="3" height="4" fill="#E2584A" />
      <g className="p-body">
        <rect x="4" y="16" width="8" height="2" fill="#2A2E40" />
        <rect x="10" y="18" width="2" height="3" fill="#2A2E40" />
        <rect x="10" y="21" width="3" height="1" fill="#14151F" />
        <rect x="3" y="9" width="7" height="7" fill={look.shirt} />
        <rect x="4" y="4" width="6" height="5" fill={look.skin} />
        <rect x="4" y="2" width="6" height="2" fill={look.hair} />
        <rect x="3" y="3" width="1" height="3" fill={look.hair} />
        <rect x="6" y="6" width="1" height="1" fill="#1B1B24" />
        <rect x="9" y="6" width="1" height="1" fill="#1B1B24" />
        <rect x="9" y="11" width="3" height="2" fill={look.shirt} />
        <g className="p-item">
          <rect x="10" y="12" width="4" height="2" fill="#1A1A2E" />
          <rect x="13" y="12" width="1" height="1" fill="#4BE3B0" />
        </g>
      </g>
    </svg>
  );
}

/** Lying under a blanket, head on a pillow. */
function Napper({ look, flip }: { look: Look; flip?: boolean }) {
  return (
    <svg className="person act-nap" viewBox="0 0 22 10" width="66" height="30" shapeRendering="crispEdges" aria-hidden="true" style={flip ? { transform: 'scaleX(-1)' } : undefined}>
      <rect x="0" y="4" width="5" height="4" fill="#FFF4D6" />
      <rect x="1" y="2" width="5" height="5" fill={look.skin} />
      <rect x="1" y="1" width="5" height="2" fill={look.hair} />
      <rect x="0" y="2" width="1" height="3" fill={look.hair} />
      <rect x="3" y="4" width="2" height="1" fill="#1B1B24" />
      <rect x="6" y="3" width="15" height="5" fill={look.shirt} />
      <rect x="6" y="3" width="15" height="1" fill="#FFFFFF" opacity="0.35" />
      <rect x="9" y="5" width="1" height="3" fill="#000000" opacity="0.15" />
      <rect x="15" y="5" width="1" height="3" fill="#000000" opacity="0.15" />
    </svg>
  );
}
