import { useEffect, useRef, useState } from 'react';
import type { ChatEntry, MergeRequest } from '../../../shared/types';

function Entry({ e }: { e: ChatEntry }) {
  switch (e.kind) {
    case 'user': return <div className="msg user">{e.text}</div>;
    case 'boss': return <div className="msg boss pre">{e.text}</div>;
    case 'report': return <div className="msg report pre">{e.text}</div>;
    case 'error': return <div className="msg error pre" role="alert">{e.text}</div>;
    case 'event': return <div className="msg event small">{e.text}</div>;
    case 'tool': return (
      <div className="msg tool mono small">
        <span className="tool-name">{e.tool}</span> {JSON.stringify(e.input).slice(0, 200)}
      </div>
    );
  }
}

export function BossChat({ chat, merges, onError }: { chat: ChatEntry[]; merges: MergeRequest[]; onError: (m: string) => void }) {
  const [draft, setDraft] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [chat.length, merges.length]);

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    try { await window.agentOffice.sendToBoss(text); } catch (e) { onError(String(e)); setDraft(text); }
  };
  const answer = (id: string, ok: boolean) => { window.agentOffice.answerMerge(id, ok).catch((e: unknown) => onError(String(e))); };

  return (
    <section className="panel chat" aria-label="Boss chat">
      <h2>Boss</h2>
      <div className="messages">
        {chat.length === 0 && <p className="muted">Tell the boss what to build.</p>}
        {chat.map((e, i) => <Entry key={i} e={e} />)}
        {merges.map((m) => (
          <div key={m.requestId} className="merge-card" role="group" aria-label={`Merge request for ${m.taskId}`}>
            <div><strong>Merge {m.taskId}?</strong> {m.title} <span className="muted">by {m.agentName}</span></div>
            {m.summary && <p className="small pre">{m.summary}</p>}
            {m.diffStat.length > 0 && <ul className="mono small files">{m.diffStat.map((f) => <li key={f.path}>{f.path} <span className="add">+{f.add}</span> <span className="del">−{f.del}</span></li>)}</ul>}
            <div className="card-actions">
              <button type="button" className="primary" onClick={() => answer(m.requestId, true)}>Merge</button>
              <button type="button" onClick={() => answer(m.requestId, false)}>Decline</button>
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <label htmlFor="boss-msg" className="sr-only">Message the boss</label>
        <textarea
          id="boss-msg"
          rows={3}
          value={draft}
          placeholder="Describe what the team should build… (Enter to send, Shift+Enter for a new line)"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
        />
        <button type="submit" className="primary">Send</button>
      </form>
    </section>
  );
}
