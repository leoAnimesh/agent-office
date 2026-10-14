import { useEffect, useState } from 'react';
import type { LogEntry, Role, WorkspaceSnapshot } from '../../../shared/types';
import { currentTask, formatLog } from '../agent/logView';
import { displayState } from '../office/model';
import { DeskSprite } from '../sprites/DeskSprite';
import { STATUS_COLORS, STATUS_LABEL, lookFor } from '../sprites/sprite';

interface Props { ws: WorkspaceSnapshot; roles: Role[]; agentId: string; logs: LogEntry[]; onBack: () => void; onLogs: (entries: LogEntry[]) => void; onError: (m: string) => void }

export function AgentDetailView({ ws, roles, agentId, logs, onBack, onLogs, onError }: Props) {
  const [message, setMessage] = useState('');
  const agent = ws.agents.find((a) => a.id === agentId);
  useEffect(() => { window.agentOffice.agentLog(agentId).then(onLogs, () => undefined); }, [agentId, onLogs]);
  if (!agent) return <p className="muted">That agent is no longer on the team.</p>;

  const role = roles.find((r) => r.id === agent.roleId);
  const st = displayState(agent, ws.tasks);
  const task = currentTask(agent.id, ws.tasks);
  const isBoss = agent.kind === 'boss';
  const lines = logs.map(formatLog).filter((l) => l !== null);
  const live = st.status === 'working' || st.status === 'thinking';
  const act = (fn: () => Promise<void>) => () => { fn().catch((e: unknown) => onError(String(e))); };

  const send = async () => {
    const text = message.trim();
    if (!text) return;
    try { await window.agentOffice.messageAgent(agent.id, text); setMessage(''); } catch (e) { onError(String(e)); }
  };

  return (
    <section aria-label={`${agent.name} details`} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div><button type="button" className="btn small" onClick={onBack}>← Back to office</button></div>
      <div className="detail-top">
        <div className="detail-desk">
          <DeskSprite name={agent.name} role={isBoss ? 'Boss' : role?.name ?? agent.roleId} look={lookFor(agent, roles)} status={st.status} bubble={st.bubble} />
        </div>
        <div style={{ flex: '999 1 420px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="row">
            <h2 className="pixel" style={{ margin: 0, fontSize: 30, overflowWrap: 'anywhere' }}>{agent.name}</h2>
            <span className="muted">{isBoss ? 'Boss' : role?.name}</span>
            <span className="status-chip" style={{ background: STATUS_COLORS[st.status].dot }}>{STATUS_LABEL[st.status]}</span>
          </div>
          <dl className="meta">
            <div><dt>Model</dt><dd>claude · {role?.model ?? '?'}</dd></div>
            <div><dt>Permissions</dt><dd>{role?.permissionMode ?? '?'}</dd></div>
            <div><dt>Worktree</dt><dd>{agent.worktreePath ? `.agentoffice/wt/${agent.worktreePath.split(/[\\/]/).pop()}` : '—'}</dd></div>
            <div><dt>Branch</dt><dd>{task?.branch ?? '—'}</dd></div>
          </dl>
          {role && role.skills.length > 0 && <div className="row">{role.skills.map((s) => <span key={s} className="chip">{s}</span>)}</div>}
          {!isBoss && (
            <div className="row">
              {task?.status === 'working' && <button type="button" className="btn" onClick={act(() => window.agentOffice.pauseTask(task.id))}>Pause</button>}
              {task?.status === 'queued' && task.held && <button type="button" className="btn" onClick={act(() => window.agentOffice.resumeTask(task.id))}>Resume</button>}
              {agent.worktreePath && <button type="button" className="btn" onClick={act(() => window.agentOffice.openWorktree(agent.id))}>Open worktree</button>}
              {task && <button type="button" className="btn danger" onClick={act(() => window.agentOffice.cancelTask(task.id))}>Cancel {task.id}</button>}
            </div>
          )}
        </div>
      </div>

      {isBoss ? (
        <p className="muted">The boss's conversation is in the chat on the right.</p>
      ) : (
        <div className="row" style={{ alignItems: 'stretch' }}>
          <section aria-label="Live session" style={{ flex: '999 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="row"><strong>Live session</strong>{live && <span className="small" style={{ color: 'var(--teal)' }}>● streaming</span>}</div>
            <div className="log" aria-live="polite">
              {lines.length === 0 && <span className="muted">No activity yet.</span>}
              {lines.map((l, i) => (
                <div key={i} className="log-line"><span className="log-time">{l.time}</span><span className={`tone-${l.tone}`}>{l.kind}</span><span className={l.tone === 'result' ? 'muted' : ''}>{l.text}</span></div>
              ))}
              {live && <div className="log-line"><span /><span /><span className="cursor-blink" style={{ color: 'var(--teal)' }} aria-hidden="true">▌</span></div>}
            </div>
            <form className="row" onSubmit={(e) => { e.preventDefault(); void send(); }}>
              <label htmlFor="agent-msg" className="sr-only">Message {agent.name}</label>
              <input id="agent-msg" className="input" style={{ flex: 1, minWidth: 200 }} placeholder={`Message ${agent.name}…`} value={message} onChange={(e) => setMessage(e.target.value)} />
              <button type="submit" className="btn teal">Send</button>
            </form>
          </section>
          <div style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <section className="panel-box" aria-label="Current task">
              {task ? (
                <>
                  <div className="card-meta"><span>{task.id}</span><span>from {task.createdBy === 'boss' ? 'the boss' : 'you'}</span><span>{task.status}</span></div>
                  <h3 style={{ margin: 0, fontSize: 16 }}>{task.title}</h3>
                  <p className="small pre" style={{ margin: 0, color: '#c9cbd8' }}>{task.brief}</p>
                </>
              ) : <p className="muted" style={{ margin: 0 }}>No open task.</p>}
            </section>
            {task?.diffStat && task.diffStat.length > 0 && (
              <section className="panel-box" aria-label="Changes">
                <h3 style={{ margin: 0, fontSize: 14 }}>Changes on branch</h3>
                <ul className="files mono small">{task.diffStat.map((f) => <li key={f.path} className="row"><span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{f.path}</span><span className="add">+{f.add}</span><span className="del">−{f.del}</span></li>)}</ul>
              </section>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
