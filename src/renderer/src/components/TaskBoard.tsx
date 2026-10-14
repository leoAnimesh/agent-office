import { useState } from 'react';
import type { Role, WorkspaceSnapshot } from '../../../shared/types';
import { Avatar } from '../sprites/Avatar';
import { lookFor } from '../sprites/sprite';
import { COLUMNS, cardMeta, filterTasks } from '../tasks/board';

interface Props { ws: WorkspaceSnapshot; roles: Role[]; onOpenAgent: (id: string) => void; onNewTask: () => void; onError: (m: string) => void }

export function TaskBoard({ ws, roles, onOpenAgent, onNewTask, onError }: Props) {
  const [who, setWho] = useState<string>('all');
  const employees = ws.agents.filter((a) => a.kind === 'employee');
  const tasks = filterTasks(ws.tasks, who);
  const act = (fn: () => Promise<void>) => () => { fn().catch((e: unknown) => onError(String(e))); };

  return (
    <section aria-label="Task board">
      <div className="board-head">
        <div className="row">
          <label htmlFor="tb-filter" className="small muted">Assignee</label>
          <select id="tb-filter" className="input" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="all">Everyone</option>
            {employees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <button type="button" className="btn primary" onClick={onNewTask}>New task for {ws.agents.find((a) => a.kind === 'boss')?.name ?? 'the boss'}</button>
      </div>
      <div className="board-columns">
        {COLUMNS.map((c) => {
          const items = tasks.filter((t) => c.statuses.includes(t.status)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
          return (
            <section key={c.title} className="column" aria-label={c.title}>
              <h2><span className="dot" style={{ background: c.color }} aria-hidden="true" />{c.title}<span className="mono small muted" style={{ marginLeft: 'auto' }}>{items.length}</span></h2>
              {items.map((t) => {
                const agent = ws.agents.find((a) => a.id === t.assigneeId);
                return (
                  <article key={t.id} className="card">
                    <div className="card-meta"><span>{t.id}</span><span style={{ marginLeft: 'auto' }}>{cardMeta(t, ws.tasks)}</span></div>
                    <div className="card-title">{t.title}</div>
                    <div className="row">
                      {agent && <Avatar look={lookFor(agent, roles)} size={22} />}
                      {agent ? <button type="button" className="btn small" onClick={() => onOpenAgent(agent.id)}>{agent.name}</button> : <span className="small muted">unassigned</span>}
                      <span className="mono small muted" style={{ marginLeft: 'auto', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.branch}>{t.branch}</span>
                    </div>
                    {t.resultSummary && (
                      <details>
                        <summary className="small">Result</summary>
                        <p className="small pre">{t.resultSummary}</p>
                        {t.diffStat && t.diffStat.length > 0 && <ul className="mono small files">{t.diffStat.map((f) => <li key={f.path}>{f.path} <span className="add">+{f.add}</span> <span className="del">−{f.del}</span></li>)}</ul>}
                      </details>
                    )}
                    <div className="row">
                      {t.status === 'working' && <button type="button" className="btn small" onClick={act(() => window.agentOffice.pauseTask(t.id))}>Pause</button>}
                      {t.status === 'queued' && t.held && <button type="button" className="btn small" onClick={act(() => window.agentOffice.resumeTask(t.id))}>Resume</button>}
                      {['queued', 'working', 'needs_help', 'review'].includes(t.status) && <button type="button" className="btn small danger" onClick={act(() => window.agentOffice.cancelTask(t.id))}>Cancel</button>}
                    </div>
                  </article>
                );
              })}
            </section>
          );
        })}
      </div>
    </section>
  );
}
