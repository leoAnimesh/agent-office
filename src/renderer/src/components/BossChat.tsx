import { Fragment, memo, useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Agent, ChatEntry, Look, MergeRequest, NewAttachment } from '../../../shared/types';
import { describeToolCall } from '../chat/describe';
import { FileChanges, legacyFinishedText } from '../chat/fileChanges';
import { Markdown } from '../chat/Markdown';
import { AttachmentList } from '../chat/AttachmentList';
import { ChatComposer } from '../chat/ChatComposer';
import { StreamingBubble } from '../chat/StreamingBubble';
import { NO_UNSEEN, onMessages, onReachedBottom, onSent, type Unseen } from '../chat/unseen';
import { Avatar } from '../sprites/Avatar';
import { STATUS_COLORS, STATUS_LABEL } from '../sprites/sprite';

// Memoized: entries are append-only and keep their identity, so old messages never re-render.
const Entry = memo(function Entry({ e }: { e: ChatEntry }) {
  switch (e.kind) {
    case 'user': return (
      <div className="msg user">
        <div className="pre">{e.text}</div>
        {e.attachments && e.attachments.length > 0 && <AttachmentList list={e.attachments} />}
      </div>
    );
    case 'boss': return <div className="msg boss"><Markdown text={e.text} /></div>;
    case 'report': return <div className="msg report"><Markdown text={e.text} /></div>;
    case 'error': return <div className="msg error pre" role="alert">{e.text}</div>;
    case 'event': {
      // Older saved notices are plain text; show them in the current shape too.
      const shown = e.files ? { text: e.text, files: e.files } : legacyFinishedText(e.text);
      return (
        <div className="msg event small">
          <span className="dot" style={{ background: 'var(--green)' }} aria-hidden="true" />
          <div className="event-md">
            <Markdown text={shown.text} />
            {shown.files && <FileChanges files={shown.files} />}
          </div>
        </div>
      );
    }
    case 'tool': return (
      <div className="msg tool">
        <span className="mono small tool-name">{e.tool}</span>
        <span className="small pre">{describeToolCall(e.tool, e.input)}</span>
      </div>
    );
  }
});

interface Props { chat: ChatEntry[]; merges: MergeRequest[]; boss: Agent | undefined; bossLook: Look; bossModel: string; stream: string | null; busy: boolean; onError: (m: string) => void }

interface ListProps { chat: ChatEntry[]; markerIndex: number | null; hideIndex: number | null; marker: RefObject<HTMLDivElement | null> }

/** The saved conversation. Re-renders only when a message is added (not while typing or streaming). */
const MessageList = memo(function MessageList({ chat, markerIndex, hideIndex, marker }: ListProps) {
  return (
    <>
      {chat.length === 0 && <p className="muted">Tell the boss what to build. It will hire people and hand out tasks.</p>}
      {chat.map((e, i) => (
        <Fragment key={i}>
          {markerIndex === i && (
            <div ref={marker} className="new-marker" role="separator" aria-label="New messages"><span>New messages</span></div>
          )}
          {/* The boss's reply that just landed is still being revealed by the streaming bubble below. */}
          {i !== hideIndex && <Entry e={e} />}
        </Fragment>
      ))}
    </>
  );
});

const MergeCards = memo(function MergeCards({ merges, onAnswer }: { merges: MergeRequest[]; onAnswer: (id: string, ok: boolean) => void }) {
  return (
    <>
      {merges.map((m) => (
        <div key={m.requestId} className="merge-card" role="group" aria-label={`Merge request for ${m.taskId}`}>
          <div><strong>Merge {m.taskId}?</strong> {m.title} <span className="muted">by {m.agentName}</span></div>
          {m.summary && <div className="small"><Markdown text={m.summary} /></div>}
          {m.diffStat.length > 0 && <ul className="mono small files">{m.diffStat.map((f) => <li key={f.path}>{f.path} <span className="add">+{f.add}</span> <span className="del">−{f.del}</span></li>)}</ul>}
          <div className="row">
            <button type="button" className="btn primary small" onClick={() => onAnswer(m.requestId, true)}>Merge</button>
            <button type="button" className="btn small" onClick={() => onAnswer(m.requestId, false)}>Decline</button>
          </div>
        </div>
      ))}
    </>
  );
});

export const BossChat = memo(function BossChat({ chat, merges, boss, bossLook, bossModel, stream, busy, onError }: Props) {
  const box = useRef<HTMLDivElement>(null);
  // Follow new output only while the reader is at the bottom. Otherwise mark where the unseen
  // messages start and offer a button that jumps to that marker.
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(atBottom);
  atBottomRef.current = atBottom;
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
  // Typewriter: the streaming reply and, once it lands, the same message keep revealing in one bubble.
  const [liveIndex, setLiveIndex] = useState<number | null>(null);
  useLayoutEffect(() => { if (stream !== null && liveIndex === null) setLiveIndex(chat.length); }, [stream, liveIndex, chat.length]);
  const liveEntry = liveIndex !== null ? chat[liveIndex] : undefined;
  const landed = stream === null && liveEntry?.kind === 'boss' ? liveEntry.text : null;
  const bubbleText = stream ?? landed;
  // The bubble keeps the view pinned to the bottom as it grows, without re-rendering the chat.
  const stick = useCallback(() => { if (atBottomRef.current) { const el = box.current; if (el) el.scrollTop = el.scrollHeight; } }, []);
  const landedDone = useCallback(() => setLiveIndex(null), []);
  useLayoutEffect(() => { if (stream === null && liveIndex !== null && landed === null) setLiveIndex(null); }, [stream, liveIndex, landed]);

  // Layout effects: stick to the bottom before the browser paints, so there is no flicker and no
  // late scroll that would wrongly mark the reader as "at the bottom".
  useLayoutEffect(() => {
    const e = { prevCount: prevCount.current, count: chat.length, atBottom };
    setUnseen((u) => onMessages(u, e));
    prevCount.current = chat.length;
    if (atBottom) scrollToEnd();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.length]);
  useLayoutEffect(() => {
    if (atBottom) scrollToEnd();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merges.length, busy, stream === null]);

  const toBottomRef = useRef(toBottom);
  toBottomRef.current = toBottom;
  const onSend = useCallback(async (text: string, files: NewAttachment[]) => {
    setUnseen(onSent);
    toBottomRef.current();
    try { await window.agentOffice.sendToBoss(text, files.length > 0 ? files : undefined); return true; } catch (e) { onError(String(e)); return false; }
  }, [onError]);
  const answer = useCallback((id: string, ok: boolean) => { window.agentOffice.answerMerge(id, ok).catch((e: unknown) => onError(String(e))); }, [onError]);
  // Files dragged anywhere over the chat are handed to the composer.
  const [dragging, setDragging] = useState(false);
  const [dropped, setDropped] = useState<File[] | null>(null);
  const takeDropped = useCallback(() => setDropped(null), []);
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files');
  // dragover repeats while a file hovers; if it stops (drag cancelled or left the window) the hint goes away.
  const dragTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hovering = () => {
    setDragging(true);
    if (dragTimer.current) clearTimeout(dragTimer.current);
    dragTimer.current = setTimeout(() => setDragging(false), 400);
  };
  const status = boss?.status ?? 'idle';
  const name = boss?.name ?? 'The boss';
  const activity = boss?.status === 'working' ? boss.bubble : 'thinking';

  return (
    <section className={dragging ? 'chat dragging' : 'chat'} aria-label="Boss chat"
      onDragOver={(e) => { if (hasFiles(e)) { e.preventDefault(); hovering(); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={(e) => { if (!hasFiles(e)) return; e.preventDefault(); setDragging(false); setDropped(Array.from(e.dataTransfer.files)); }}>
      {dragging && <div className="drop-hint" aria-hidden="true">Drop to attach</div>}
      <div className="chat-head">
        <Avatar look={bossLook} size={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{boss?.name ?? 'Boss'} <span className="muted" style={{ fontWeight: 400 }}>· Boss</span></div>
          <div className="mono small muted">claude · {bossModel}</div>
        </div>
        <span className="status-chip" style={{ background: STATUS_COLORS[status].dot }}>{STATUS_LABEL[status]}</span>
      </div>
      <div className="messages-wrap">
      <div className="messages" ref={box} onScroll={onScroll} role="log" aria-label="Conversation with the boss"
        data-at-bottom={atBottom} data-unseen={unseen.count} data-marker={unseen.markerIndex ?? ''} data-count={chat.length}>
        <MessageList chat={chat} markerIndex={unseen.markerIndex} hideIndex={landed !== null ? liveIndex : null} marker={marker} />
        {bubbleText !== null && <StreamingBubble text={bubbleText} onGrow={stick} onDone={landed !== null ? landedDone : undefined} />}
        {busy && !stream && (
          <div className="msg thinking small" role="status">
            <span className="dots" aria-hidden="true"><span /><span /><span /></span>
            {name} is {activity}…
          </div>
        )}
        <MergeCards merges={merges} onAnswer={answer} />
      </div>
      {(unseen.count > 0 || (!atBottom && (stream || busy))) && (
        <button type="button" className="btn small jump" onClick={jump}>
          ↓ {unseen.count > 0 ? `${unseen.count} new message${unseen.count === 1 ? '' : 's'}` : `${name} is replying`}
        </button>
      )}
      </div>
      <ChatComposer onSend={onSend} dropped={dropped} onDroppedTaken={takeDropped} />
    </section>
  );
});
