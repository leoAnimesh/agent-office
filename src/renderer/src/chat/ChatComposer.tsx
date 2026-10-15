import { memo, useEffect, useRef, useState } from 'react';
import { canSend, checkAttachments, formatSize } from '../../../shared/attachments';
import type { NewAttachment } from '../../../shared/types';
import { prepareFile, type Pending } from './prepare';

interface Props { onSend: (text: string, files: NewAttachment[]) => Promise<boolean>; dropped: File[] | null; onDroppedTaken: () => void }

/** The message box. Owns its draft and attachments so typing never re-renders the conversation. */
export const ChatComposer = memo(function ChatComposer({ onSend, dropped, onDroppedTaken }: Props) {
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState<Pending[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  // Files still being read or scaled: sending waits for them, so a quick Enter never drops an attachment.
  const [preparing, setPreparing] = useState(0);
  const picker = useRef<HTMLInputElement>(null);

  const add = async (list: File[]) => {
    setProblem(null);
    setPreparing((n) => n + 1);
    const ready: Pending[] = [];
    try {
      for (const f of list) ready.push(await prepareFile(f));
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
      return;
    } finally {
      setPreparing((n) => n - 1);
    }
    setFiles((cur) => {
      const next = [...cur, ...ready];
      const v = checkAttachments(next.map((p) => ({ name: p.name, mime: p.mime, size: p.size })));
      if (!v.ok) { setProblem(v.reason); return cur; }
      return next;
    });
  };
  useEffect(() => { if (dropped) { void add(dropped); onDroppedTaken(); } }, [dropped]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    const text = draft.trim();
    if (preparing > 0 || !canSend(text, files.length)) return;
    const sending = files;
    setDraft(''); setFiles([]); setProblem(null);
    if (!(await onSend(text, sending.map((p) => ({ name: p.name, mime: p.mime, data: p.data }))))) { setDraft(text); setFiles(sending); }
  };

  return (
    <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <label htmlFor="boss-msg" className="small muted">Message the boss</label>
      {files.length > 0 && (
        <ul className="attach-chips" aria-label="Attachments">
          {files.map((p) => (
            <li key={p.key} className="attach-chip">
              {p.preview ? <img src={p.preview} alt="" className="attach-thumb" /> : <span className="attach-icon" aria-hidden="true">📄</span>}
              <span className="attach-name" title={p.name}>{p.name}</span>
              <span className="small muted">{formatSize(p.size)}</span>
              <button type="button" className="skill-remove" aria-label={`Remove ${p.name}`} onClick={() => setFiles((cur) => cur.filter((x) => x.key !== p.key))}>×</button>
            </li>
          ))}
        </ul>
      )}
      {problem && <p className="small attach-problem" role="alert">{problem}</p>}
      <textarea id="boss-msg" className="input" rows={3} value={draft} placeholder="Describe what the team should build…"
        onChange={(e) => setDraft(e.target.value)}
        onPaste={(e) => { const list = Array.from(e.clipboardData.files); if (list.length > 0) { e.preventDefault(); void add(list); } }}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
      <div className="row">
        <button type="button" className="btn small" onClick={() => picker.current?.click()}>📎 Attach</button>
        <input ref={picker} type="file" multiple hidden aria-hidden="true" tabIndex={-1} onChange={(e) => { const list = Array.from(e.target.files ?? []); e.target.value = ''; void add(list); }} />
        <span className="small muted" role={preparing > 0 ? 'status' : undefined}>{preparing > 0 ? 'Preparing attachment…' : 'Enter to send · Shift+Enter for a new line'}</span>
        <button type="submit" className="btn teal" style={{ marginLeft: 'auto' }} disabled={preparing > 0}>Send</button>
      </div>
    </form>
  );
});
