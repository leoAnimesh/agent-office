import { useEffect, useRef, useState } from 'react';

/**
 * How many characters of a streaming reply to show after `dtMs`. Eases out a backlog (big chunks
 * from the model drain within ~half a second) and otherwise types at a steady minimum pace.
 */
export function revealStep(shown: number, total: number, dtMs: number, reduceMotion: boolean): number {
  if (reduceMotion || shown >= total) return total;
  const remaining = total - shown;
  const step = Math.max(1, Math.ceil(remaining * (dtMs / 120) + dtMs * 0.25));
  return Math.min(total, shown + step);
}

/** Number of characters of `target` to display right now; animates toward its full length. */
export function useReveal(target: string | null): number {
  const [shown, setShown] = useState(0);
  const state = useRef({ shown: 0, total: 0 });
  state.current.total = target?.length ?? 0;
  const live = target !== null;

  useEffect(() => {
    if (!live) {
      state.current.shown = 0;
      setShown(0);
      return;
    }
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let last = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const s = state.current;
      if (s.shown < s.total) {
        s.shown = revealStep(s.shown, s.total, now - last, reduce);
        setShown(s.shown);
      }
      last = now;
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [live]);

  return Math.min(shown, target?.length ?? 0);
}
