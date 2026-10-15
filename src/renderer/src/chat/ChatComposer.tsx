import { memo, useState } from 'react';

/** The message box. Owns its own draft so typing never re-renders the conversation. */
export const ChatComposer = memo(function ChatComposer({ onSend }: { onSend: (text: string) => Promise<boolean> }) {
  const [draft, setDraft] = useState('');
  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    if (!(await onSend(text))) setDraft(text);
  };
  return (
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
  );
});
