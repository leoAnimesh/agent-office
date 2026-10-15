import { memo, useEffect, useRef, useState } from 'react';
import { formatSize } from '../../../shared/attachments';
import type { AttachmentMeta } from '../../../shared/types';

const cache = new Map<string, Promise<string | null>>();
const load = (id: string) => {
  if (!cache.has(id)) cache.set(id, window.agentOffice.readAttachment(id).catch(() => null));
  return cache.get(id)!;
};

function Thumb({ a }: { a: AttachmentMeta }) {
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { let live = true; void load(a.id).then((s) => { if (live) setSrc(s); }); return () => { live = false; }; }, [a.id]);
  if (src === null) return <span className="attach-chip small muted">Attachment unavailable</span>;
  return (
    <>
      <button type="button" className="attach-shot" aria-label={`Open ${a.name}`} onClick={() => dlg.current?.showModal()}>
        {src ? <img src={src} alt={a.name} /> : <span className="small muted">Loading…</span>}
      </button>
      <dialog ref={dlg} className="lightbox" aria-label={a.name} onClick={(e) => { if (e.target === dlg.current) dlg.current?.close(); }}>
        {src && <img src={src} alt={a.name} />}
        <button type="button" className="btn small" onClick={() => dlg.current?.close()}>Close</button>
      </dialog>
    </>
  );
}

/** Attachments under a sent message: image thumbnails (click to enlarge) and file chips. */
export const AttachmentList = memo(function AttachmentList({ list }: { list: AttachmentMeta[] }) {
  return (
    <div className="msg-attachments">
      {list.map((a) => (a.kind === 'image'
        ? <Thumb key={a.id} a={a} />
        : <span key={a.id} className="attach-chip small"><span aria-hidden="true">📄</span> <span className="attach-name" title={a.name}>{a.name}</span> <span className="muted">{formatSize(a.size)}</span></span>))}
    </div>
  );
});
