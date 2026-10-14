import { useEffect, useRef, useState } from 'react';
import type { Agent, ChatEntry, Look, MergeRequest } from '../../../shared/types';
import { describeToolCall } from '../chat/describe';
import { Avatar } from '../sprites/Avatar';
import { STATUS_COLORS, STATUS_LABEL } from '../sprites/sprite';

function Entry({ e }: { e: ChatEntry }) {
  switch (e.kind) {
    case 'user': return <div className="msg user pre">{e.text}</div>;
    case 'boss': return <div className="msg boss pre">{e.text}</div>;
    case 'report': return <div className="msg report pre">{e.text}</div>;
    case 'error': return <div className="msg error pre" role="alert">{e.text}</div>;
    case 'event': return <div className="msg event small"><span className="dot" style={{ background: 'var(--green)' }} aria-hidden="true" /> <span className="pre">{e.text}</span></div>;
    case 'tool': return (
      <div className="msg tool">
        <span className="mono small tool-name">{e.tool}</span>
        <span className="small pre">{describeToolCall(e.tool, e.input)}</span>
      </div>
    );
  }
}

interface Props { chat: ChatEntry[]; merges: MergeRequest[]; boss: Agent | undefined; bossLook: Look; bossModel: string; onError: (m: string) => void }

export function BossChat({ chat, merges, boss, bossLook, bossModel, onError }: Props) {
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
  const status = boss?.status ?? 'idle';

  return (
    <section className="chat" aria-label="Boss chat">
      <div className="chat-head">
        <Avatar look={bossLook} size={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{boss?.name ?? 'Boss'} <span className="muted" style={{ fontWeight: 400 }}>· Boss</span></div>
          <div className="mono small muted">claude · {bossModel}</div>
        </div>
        <span className="status-chip" style={{ background: STATUS_COLORS[status].dot }}>{STATUS_LABEL[status]}</span>
      </div>
      <div className="messages">
        {chat.length === 0 && <p className="muted">Tell the boss what to build. It will hire people and hand out tasks.</p>}
        {chat.map((e, i) => <Entry key={i} e={e} />)}
        {merges.map((m) => (
          <div key={m.requestId} className="merge-card" role="group" aria-label={`Merge request for ${m.taskId}`}>
            <div><strong>Merge {m.taskId}?</strong> {m.title} <span className="muted">by {m.agentName}</span></div>
            {m.summary && <p className="small pre">{m.summary}</p>}
            {m.diffStat.length > 0 && <ul className="mono small files">{m.diffStat.map((f) => <li key={f.path}>{f.path} <span className="add">+{f.add}</span> <span className="del">−{f.del}</span></li>)}</ul>}
            <div className="row">
              <button type="button" className="btn primary small" onClick={() => answer(m.requestId, true)}>Merge</button>
              <button type="button" className="btn small" onClick={() => answer(m.requestId, false)}>Decline</button>
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <label htmlFor="boss-msg" className="small muted">Message the boss</label>
        <textarea id="boss-msg" className="input" rows={3} value={draft} placeholder="Describe what the team should build…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
        <div className="row">
          <span className="small muted">Enter to send · Shift+Enter for a new line</span>
          <button type="submit" className="btn teal" style={{ marginLeft: 'auto' }}>Send</button>
        </div>
      </form>
    </section>
  );
}
