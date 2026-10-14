import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Agent, ChatEntry, Look, MergeRequest } from '../../../shared/types';
import { describeToolCall } from '../chat/describe';
import { Markdown } from '../chat/Markdown';
import { useReveal } from '../chat/reveal';
import { NO_UNSEEN, onMessages, onReachedBottom, onSent, type Unseen } from '../chat/unseen';
import { Avatar } from '../sprites/Avatar';
import { STATUS_COLORS, STATUS_LABEL } from '../sprites/sprite';

function Entry({ e }: { e: ChatEntry }) {
  switch (e.kind) {
    case 'user': return <div className="msg user pre">{e.text}</div>;
    case 'boss': return <div className="msg boss"><Markdown text={e.text} /></div>;
    case 'report': return <div className="msg report"><Markdown text={e.text} /></div>;
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

interface Props { chat: ChatEntry[]; merges: MergeRequest[]; boss: Agent | undefined; bossLook: Look; bossModel: string; stream: string | null; busy: boolean; onError: (m: string) => void }

export function BossChat({ chat, merges, boss, bossLook, bossModel, stream, busy, onError }: Props) {
  const [draft, setDraft] = useState('');
  const box = useRef<HTMLDivElement>(null);
  // Follow new output only while the reader is at the bottom. Otherwise mark where the unseen
  // messages start and offer a button that jumps to that marker.
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState<Unseen>(NO_UNSEEN);
  const prevCount = useRef(chat.length);
  const marker = useRef<HTMLDivElement>(null);
  const scrollToEnd = () => { const el = box.current; if (el) el.scrollTop = el.scrollHeight; };
  const toBottom = () => { scrollToEnd(); setAtBottom(true); setUnseen(onReachedBottom); };
  const jump = () => {
    if (unseen.count > 0 && marker.current) {
      marker.current.scrollIntoView({ block: 'start', behavior: 'smooth' });
      setUnseen((u) => ({ ...u, count: 0 }));
    } else toBottom();
  };
  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setAtBottom(near);
    if (near) setUnseen(onReachedBottom);
  };
  // Typewriter: the streaming reply and, once it lands, the same message keep revealing smoothly.
  const [liveIndex, setLiveIndex] = useState<number | null>(null);
  useLayoutEffect(() => { if (stream !== null && liveIndex === null) setLiveIndex(chat.length); }, [stream, liveIndex, chat.length]);
  const liveEntry = liveIndex !== null ? chat[liveIndex] : undefined;
  const landed = stream === null && liveEntry?.kind === 'boss' ? liveEntry.text : null;
  const liveText = stream ?? landed;
  const shown = useReveal(liveText);
  useEffect(() => {
    if (liveIndex !== null && stream === null && (landed === null || shown >= landed.length)) setLiveIndex(null);
  }, [liveIndex, stream, landed, shown]);

  // Layout effects: stick to the bottom before the browser paints, so there is no flicker and no
  // late scroll that would wrongly mark the reader as "at the bottom".
  useLayoutEffect(() => {
    setUnseen((u) => onMessages(u, { prevCount: prevCount.current, count: chat.length, atBottom }));
    prevCount.current = chat.length;
    if (atBottom) scrollToEnd();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.length]);
  useLayoutEffect(() => {
    if (atBottom) scrollToEnd();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merges.length, stream, busy, shown]);

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    setUnseen(onSent);
    toBottom();
    try { await window.agentOffice.sendToBoss(text); } catch (e) { onError(String(e)); setDraft(text); }
  };
  const answer = (id: string, ok: boolean) => { window.agentOffice.answerMerge(id, ok).catch((e: unknown) => onError(String(e))); };
  const status = boss?.status ?? 'idle';
  const name = boss?.name ?? 'The boss';
  const activity = boss?.status === 'working' ? boss.bubble : 'thinking';

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
      <div className="messages-wrap">
      <div className="messages" ref={box} onScroll={onScroll} role="log" aria-label="Conversation with the boss">
        {chat.length === 0 && <p className="muted">Tell the boss what to build. It will hire people and hand out tasks.</p>}
        {chat.map((e, i) => (
          <Fragment key={i}>
            {unseen.markerIndex === i && (
              <div ref={marker} className="new-marker" role="separator" aria-label="New messages"><span>New messages</span></div>
            )}
            {i === liveIndex && landed !== null && shown < landed.length ? (
              <div className="msg boss streaming" aria-busy="true">
                <Markdown text={landed.slice(0, shown)} />
                <span className="cursor-blink stream-cursor" aria-hidden="true">▌</span>
              </div>
            ) : <Entry e={e} />}
          </Fragment>
        ))}
        {stream && (
          <div className="msg boss streaming" aria-busy="true">
            <Markdown text={stream.slice(0, shown)} />
            <span className="cursor-blink stream-cursor" aria-hidden="true">▌</span>
          </div>
        )}
        {busy && !stream && (
          <div className="msg thinking small" role="status">
            <span className="dots" aria-hidden="true"><span /><span /><span /></span>
            {name} is {activity}…
          </div>
        )}
        {merges.map((m) => (
          <div key={m.requestId} className="merge-card" role="group" aria-label={`Merge request for ${m.taskId}`}>
            <div><strong>Merge {m.taskId}?</strong> {m.title} <span className="muted">by {m.agentName}</span></div>
            {m.summary && <div className="small"><Markdown text={m.summary} /></div>}
            {m.diffStat.length > 0 && <ul className="mono small files">{m.diffStat.map((f) => <li key={f.path}>{f.path} <span className="add">+{f.add}</span> <span className="del">−{f.del}</span></li>)}</ul>}
            <div className="row">
              <button type="button" className="btn primary small" onClick={() => answer(m.requestId, true)}>Merge</button>
              <button type="button" className="btn small" onClick={() => answer(m.requestId, false)}>Decline</button>
            </div>
          </div>
        ))}
      </div>
      {(unseen.count > 0 || (!atBottom && (stream || busy))) && (
        <button type="button" className="btn small jump" onClick={jump}>
          ↓ {unseen.count > 0 ? `${unseen.count} new message${unseen.count === 1 ? '' : 's'}` : `${name} is replying`}
        </button>
      )}
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
