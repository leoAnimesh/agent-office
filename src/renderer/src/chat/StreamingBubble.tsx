import { useLayoutEffect } from 'react';
import { Markdown } from './Markdown';
import { useReveal } from './reveal';

/** The boss's reply as it streams in. Only this re-renders per animation frame, not the whole chat. */
export function StreamingBubble({ text, onGrow, onDone }: { text: string; onGrow: () => void; onDone?: () => void }) {
  const shown = useReveal(text);
  useLayoutEffect(() => { onGrow(); if (onDone && shown >= text.length) onDone(); }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="msg boss streaming" aria-busy="true">
      <Markdown text={text.slice(0, shown)} />
      <span className="cursor-blink stream-cursor" aria-hidden="true">▌</span>
    </div>
  );
}
