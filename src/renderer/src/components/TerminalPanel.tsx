import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

/** Colours come from the app's tokens so the terminal matches the theme. */
function themeFromTokens(): Record<string, string> {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    background: v('--panel', '#181926'),
    foreground: v('--text', '#ece8df'),
    cursor: v('--amber', '#f5b942'),
    selectionBackground: v('--line-2', '#3a3f58'),
    red: v('--red', '#ff7a6b'),
    green: v('--green', '#8bd47a'),
    yellow: v('--amber', '#f5b942'),
    blue: v('--blue', '#7aa2ff'),
    cyan: v('--teal', '#52d1be'),
  };
}

/**
 * The open project's shell, drawn with xterm.js. The shell runs in the main process (always in the project
 * folder); this component only sends keystrokes and sizes and draws what comes back.
 */
export function TerminalPanel({ projectId, visible, onError }: { projectId: string; visible: boolean; onError: (m: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const [exited, setExited] = useState<number | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);

  useEffect(() => {
    const term = new Terminal({
      fontFamily: '"IBM Plex Mono", ui-monospace, monospace', fontSize: 13, cursorBlink: true,
      scrollback: 5000, screenReaderMode: true, theme: themeFromTokens(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    // Links open in the user's browser through the app's checked external-link path, never in this window.
    term.loadAddon(new WebLinksAddon((_e, uri) => { void window.agentOffice.openExternal(uri).catch(() => undefined); }));
    term.open(host.current!);
    termRef.current = term;
    const fitNow = () => { try { fit.fit(); } catch { /* hidden: no size yet */ } };
    fitNow();

    let disposed = false;
    const off = window.agentOffice.onTerminal((e) => {
      if (e.projectId !== projectId) return;
      if (e.type === 'data') term.write(e.data);
      else setExited(e.exitCode);
    });
    window.agentOffice.terminalOpen(term.cols || 80, term.rows || 24).then(
      ({ backlog }) => { if (!disposed && backlog) term.write(backlog); },
      (e: unknown) => setUnavailable(String(e).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '')),
    );
    const input = term.onData((d) => { void window.agentOffice.terminalWrite(d).catch(() => undefined); });
    const ro = new ResizeObserver(() => {
      if (!host.current?.offsetHeight) return;
      fitNow();
      void window.agentOffice.terminalResize(term.cols, term.rows).catch(() => undefined);
    });
    ro.observe(host.current!);
    term.focus();
    return () => { disposed = true; off(); input.dispose(); ro.disconnect(); term.dispose(); termRef.current = null; };
  }, [projectId]);

  // Showing the panel again puts the keyboard back in the shell.
  useEffect(() => { if (visible) termRef.current?.focus(); }, [visible]);

  const restart = async () => {
    const term = termRef.current;
    if (!term) return;
    try {
      term.reset();
      setExited(null);
      await window.agentOffice.terminalRestart(term.cols || 80, term.rows || 24);
      term.focus();
    } catch (e) { onError(String(e)); }
  };

  return (
    <div className="terminal-panel">
      {unavailable && <p className="terminal-note" role="alert">{unavailable}</p>}
      {exited !== null && (
        <p className="terminal-note" role="status">
          Shell exited (code {exited}). <button type="button" className="btn small" onClick={() => void restart()}>Restart</button>
        </p>
      )}
      <div ref={host} className="terminal-host" aria-label="Terminal" />
    </div>
  );
}
