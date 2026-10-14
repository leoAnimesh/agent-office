import type { Look } from '../../../shared/types';

export type PersonPose = 'coffee' | 'snack' | 'chat';

/** A small standing figure for the cafeteria and washroom. Purely decorative (the button around it is labelled). */
export function PersonSprite({ look, pose, flip }: { look: Look; pose: PersonPose; flip?: boolean }) {
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
        </g>
      </g>
    </svg>
  );
}
