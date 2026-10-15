import { useLayoutEffect } from 'react';
import { Markdown } from './Markdown';
import { useReveal } from './reveal';

/** The boss's reply as it streams in. Only this re-renders per animation frame, not the whole chat. */
export function StreamingBubble({ text, onGrow, onDone }: { text: string; onGrow: () => void; onDone?: () => void }) {
  const shown = useReveal(text);
  useLayoutEffect(() => { onGrow(); }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps
  // Also checked when the reply lands (onDone appears): the reveal may already have caught up by then.
  useLayoutEffect(() => { if (onDone && shown >= text.length) onDone(); }, [shown, text, onDone]);
  return (
    <div className="msg boss streaming" aria-busy="true">
      <Markdown text={text.slice(0, shown)} />
      <span className="cursor-blink stream-cursor" aria-hidden="true">▌</span>
    </div>
  );
}
