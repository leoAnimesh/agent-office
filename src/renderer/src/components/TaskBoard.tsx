import { useState } from 'react';
import type { Role, WorkspaceSnapshot } from '../../../shared/types';
import { Avatar } from '../sprites/Avatar';
import { lookFor } from '../sprites/sprite';
import { COLUMNS, cardMeta, filterTasks } from '../tasks/board';
import { modelChip } from '../tasks/modelChip';
import { TaskDrawer } from './TaskDrawer';

interface Props { ws: WorkspaceSnapshot; roles: Role[]; onOpenAgent: (id: string) => void; onNewTask: () => void; onError: (m: string) => void }

export function TaskBoard({ ws, roles, onOpenAgent, onNewTask, onError }: Props) {
  const [who, setWho] = useState<string>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const open = openId ? ws.tasks.find((t) => t.id === openId) : undefined;
  const employees = ws.agents.filter((a) => a.kind === 'employee');
  const tasks = filterTasks(ws.tasks, who);

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
                  // The title button is the keyboard/screen-reader way in; a click anywhere on the card does the same.
                  <article key={t.id} className="card task-card" onClick={() => setOpenId(t.id)}>
                    <div className="card-meta"><span>{t.id}</span><span style={{ marginLeft: 'auto' }}>{cardMeta(t, ws.tasks)}</span></div>
                    <button type="button" className="card-title card-open" aria-haspopup="dialog" onClick={(e) => { e.stopPropagation(); setOpenId(t.id); }}>{t.title}</button>
                    {(() => { const chip = modelChip(t); return chip && <span className="model-chip" title={chip.title}>{chip.label}</span>; })()}
                    <div className="row">
                      {agent && <Avatar look={lookFor(agent, roles)} size={22} />}
                      <span className="small">{agent?.name ?? 'unassigned'}</span>
                    </div>
                  </article>
                );
              })}
            </section>
          );
        })}
      </div>
      {open && <TaskDrawer key={open.id} task={open} ws={ws} roles={roles} onClose={() => setOpenId(null)} onOpenAgent={onOpenAgent} onError={onError} />}
    </section>
  );
}
