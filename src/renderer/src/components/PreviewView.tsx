import { useEffect, useRef, useState } from 'react';
import type { PreviewTab, WorkspaceSnapshot } from '../../../shared/types';
import { emptyState, fitRect, keyToInput, statusLine, toFraction, wheelGate } from '../preview/input';
import { deviceStatus, targetLabel } from '../preview/targets';

interface Props { ws: WorkspaceSnapshot; onError: (m: string) => void }

/** Watch an employee's browser tab or a project device live, and click or type into it. */
export function PreviewView({ ws, onError }: Props) {
  const [tabs, setTabs] = useState<PreviewTab[]>([]);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [frames, setFrames] = useState(0);
  const [browserOk, setBrowserOk] = useState<boolean | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const frameSize = useRef({ w: 1280, h: 800 });
  const fail = (e: unknown) => onError(String(e));
  const nameOf = (id: string) => ws.agents.find((a) => a.id === id)?.name ?? 'Employee';

  // Until the user picks something, follow the first employee's browser tab (devices are listed after tabs).
  const picked = useRef(false);
  const refresh = () => window.agentOffice.previewList().then((list) => {
    setTabs(list);
    setAgentId((cur) => {
      if (cur && list.some((t) => t.agentId === cur) && (picked.current || !list.some((t) => !t.device) || !list.find((t) => t.agentId === cur)?.device)) return cur;
      return (list.find((t) => !t.device) ?? list[0])?.agentId ?? null;
    });
  }, fail);
  // With no tabs yet, check that a browser can start at all, so a missing one is reported here.
  const noTabs = tabs.length === 0;
  useEffect(() => { if (noTabs) window.agentOffice.previewAvailable().then(setBrowserOk, () => setBrowserOk(false)); }, [noTabs]);
  useEffect(() => {
    void refresh();
    return window.agentOffice.onEvent((e) => { if (e.type === 'preview-changed') void refresh(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Stream only the selected tab, and only while this view is open.
  useEffect(() => {
    void window.agentOffice.previewWatch(agentId).catch(fail);
    const off = window.agentOffice.onPreviewFrame((f) => {
      if (f.agentId !== agentId || !canvas.current) { void window.agentOffice.previewAck(); return; }
      const img = new Image();
      img.onload = () => {
        const c = canvas.current;
        if (c) {
          const box = c.getBoundingClientRect();
          c.width = Math.round(box.width * devicePixelRatio);
          c.height = Math.round(box.height * devicePixelRatio);
          const ctx = c.getContext('2d')!;
          const r = fitRect(c.width, c.height, img.width, img.height);
          ctx.clearRect(0, 0, c.width, c.height);
          ctx.drawImage(img, r.x, r.y, r.w, r.h);
          frameSize.current = { w: img.width, h: img.height };
          setFrames((n) => n + 1);
        }
        void window.agentOffice.previewAck();
      };
      img.src = `data:${f.mime ?? 'image/jpeg'};base64,${f.data}`;
    });
    return () => { off(); void window.agentOffice.previewWatch(null); };
  }, [agentId]); // eslint-disable-line react-hooks/exhaustive-deps

  const at = (e: { clientX: number; clientY: number }) => {
    const c = canvas.current!;
    const box = c.getBoundingClientRect();
    return toFraction(e.clientX - box.left, e.clientY - box.top, fitRect(box.width, box.height, frameSize.current.w, frameSize.current.h));
  };
  const tab = tabs.find((t) => t.agentId === agentId);
  const device = tab?.device;
  // A device without idb (iOS) can be watched but not driven.
  const send = (ev: Parameters<typeof window.agentOffice.previewInput>[1]) => { if (agentId && (!device || (device.running && device.canInput))) void window.agentOffice.previewInput(agentId, ev).catch(fail); };
  // Booting can take minutes: show it, and don't offer Start twice.
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const act = (action: 'start' | 'home' | 'back' | 'shutdown') => {
    if (!device) return;
    if (action === 'start' || action === 'shutdown') setBusyAction(action);
    void window.agentOffice.previewDevice(device.kind, action).catch(fail).finally(() => setBusyAction(null));
  };
  const deviceWheel = useRef(wheelGate(400));

  const empty = emptyState(browserOk);
  if (tabs.length === 0) {
    return (
      <div className="preview preview-empty">
        <p className="muted" role={empty.install ? 'alert' : undefined}>{empty.text}</p>
        {empty.install && <button type="button" className="btn small" onClick={() => void window.agentOffice.openExternal('https://www.google.com/chrome/').catch(fail)}>Get Google Chrome</button>}
      </div>
    );
  }
  return (
    <div className="preview">
      <div className="row preview-bar">
        <label htmlFor="preview-agent" className="small muted">Show</label>
        <select id="preview-agent" className="input" value={agentId ?? ''} onChange={(e) => { picked.current = true; setAgentId(e.target.value); }}>
          {tabs.map((t) => <option key={t.agentId} value={t.agentId}>{targetLabel(t, nameOf)}</option>)}
        </select>
        {tab && <span className="small muted mono preview-status" title={tab.title}>{device ? deviceStatus(tab, nameOf) : statusLine(tab, nameOf(tab.agentId))}</span>}
        {device ? (
          <span className="preview-actions">
            {!device.running && <button type="button" className="btn small" disabled={busyAction === 'start'} onClick={() => act('start')}>{busyAction === 'start' ? 'Starting… (this can take a few minutes)' : 'Start'}</button>}
            {device.running && device.canInput && <button type="button" className="btn small" onClick={() => act('home')}>Home</button>}
            {device.running && device.canInput && device.kind === 'android' && <button type="button" className="btn small" onClick={() => act('back')}>Back</button>}
            {device.running && device.startedByApp && <button type="button" className="btn small" disabled={busyAction === 'shutdown'} onClick={() => act('shutdown')}>{busyAction === 'shutdown' ? 'Shutting down…' : 'Shut down'}</button>}
          </span>
        ) : (
          <span className="preview-actions">
            <button type="button" className="btn small" disabled={!agentId} onClick={() => agentId && void window.agentOffice.previewReload(agentId).catch(fail)}>Reload</button>
            <button type="button" className="btn small" disabled={!tab?.url.startsWith('http')} onClick={() => tab && void window.agentOffice.openExternal(tab.url).catch(fail)}>Open in my browser</button>
            <button type="button" className="btn small" disabled={!tab?.devServer?.running} onClick={() => agentId && void window.agentOffice.previewStopDevServer(agentId).catch(fail)}>Stop dev server</button>
          </span>
        )}
      </div>
      <canvas
        ref={canvas}
        className="preview-canvas"
        role="application"
        tabIndex={0}
        data-frames={frames}
        aria-label={device ? `Live view of the ${device.kind === 'android' ? 'Android' : 'iOS'} device` : `Live view of ${tab ? nameOf(tab.agentId) : 'the employee'}'s browser tab`}
        onMouseDown={(e) => { e.currentTarget.focus(); const p = at(e); if (p) send({ kind: 'click', x: p.x, y: p.y, button: e.button === 2 ? 'right' : 'left' }); }}
        onContextMenu={(e) => e.preventDefault()}
        onWheel={(e) => { if (device && !deviceWheel.current(e.timeStamp)) return; const p = at(e); if (p) send({ kind: 'wheel', x: p.x, y: p.y, dy: Math.max(-5000, Math.min(5000, e.deltaY)) }); }}
        onKeyDown={(e) => { const ev = keyToInput(e); if (ev) { e.preventDefault(); send(ev); } }}
      />
    </div>
  );
}
