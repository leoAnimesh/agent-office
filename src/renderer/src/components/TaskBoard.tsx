import { useState } from 'react';
import type { Role, Task, WorkspaceSnapshot } from '../../../shared/types';
import { Avatar } from '../sprites/Avatar';
import { lookFor } from '../sprites/sprite';
import { COLUMNS, cardMeta, filterTasks } from '../tasks/board';
import { modelChip } from '../tasks/modelChip';
import { dropAction, dropMode, queueDropBefore, type Column } from '../tasks/moves';
import { canReassign, queueOf } from '../tasks/taskDetail';
import { TaskDrawer } from './TaskDrawer';

interface Props { ws: WorkspaceSnapshot; roles: Role[]; onOpenAgent: (id: string) => void; onNewTask: () => void; onError: (m: string) => void }

/** Where a queued card being dragged would land: before/after the card under the pointer. */
interface Insert { over: string; half: 'top' | 'bottom'; before: string | null | undefined }

export function TaskBoard({ ws, roles, onOpenAgent, onNewTask, onError }: Props) {
  const [who, setWho] = useState<string>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [insert, setInsert] = useState<Insert | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const open = openId ? ws.tasks.find((t) => t.id === openId) : undefined;
  const dragged = dragId ? ws.tasks.find((t) => t.id === dragId) : undefined;
  const employees = ws.agents.filter((a) => a.kind === 'employee');
  const tasks = filterTasks(ws.tasks, who);
  const queueIds = queueOf(ws.tasks).map((t) => t.id);

  const run = (p: Promise<void>) => { p.catch((e: unknown) => onError(String(e))); };
  const endDrag = () => { setDragId(null); setInsert(null); };

  const dropOn = (column: Column) => {
    if (!dragged) return;
    if (dropMode(dragged, column) === 'reorder') {
      if (insert) { if (insert.before !== undefined) run(window.agentOffice.moveTask(dragged.id, insert.before)); }
      // Dropped on empty space in the column: to the end of the queue (unless it is already last).
      else if (queueIds.at(-1) !== dragged.id) run(window.agentOffice.moveTask(dragged.id, null));
    } else {
      switch (dropAction(dragged, column)) {
        case 'merge': run(window.agentOffice.mergeNow(dragged.id)); break;
        case 'pause': run(window.agentOffice.pauseTask(dragged.id)); break;
        case 'resume': run(window.agentOffice.resumeTask(dragged.id)); break;
        case 'cancel': setConfirmCancel(dragged.id); break;
        default: break;
      }
    }
    endDrag();
  };

  const overCard = (e: React.DragEvent, t: Task) => {
    if (!dragged || dragged.status !== 'queued' || t.status !== 'queued') return;
    const box = e.currentTarget.getBoundingClientRect();
    const half = e.clientY < box.top + box.height / 2 ? 'top' : 'bottom';
    if (insert?.over !== t.id || insert.half !== half) setInsert({ over: t.id, half, before: queueDropBefore(queueIds, dragged.id, t.id, half) });
  };

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
          const inColumn = tasks.filter((t) => c.statuses.includes(t.status));
          // The queue reads top to bottom in the order tasks will start; other columns show the latest first.
          const items = c.key === 'queued' ? queueOf(inColumn) : inColumn.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
          const mode = dragged ? dropMode(dragged, c.key) : null;
          const handover = c.key === 'queued' && dragged && canReassign(dragged) ? employees.filter((a) => a.id !== dragged.assigneeId) : [];
          return (
            <section key={c.key} aria-label={c.title}
              className={`column${dragged ? (mode ? ' drop-ok' : ' drop-no') : ''}`}
              onDragOver={(e) => { if (mode) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
              onDrop={(e) => { e.preventDefault(); if (mode) dropOn(c.key); else endDrag(); }}>
              <h2><span className="dot" style={{ background: c.color }} aria-hidden="true" />{c.title}<span className="mono small muted" style={{ marginLeft: 'auto' }}>{items.length}</span></h2>
              {handover.length > 0 && (
                // Drop targets only while dragging; the details panel's "Assign to" is the keyboard way.
                <div className="handover" aria-hidden="true">
                  <span className="small muted">Hand to</span>
                  {handover.map((a) => (
                    <div key={a.id} className="handover-target" title={`Hand to ${a.name}`}
                      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (dragged) run(window.agentOffice.reassignTask(dragged.id, a.name)); endDrag(); }}>
                      <Avatar look={lookFor(a, roles)} size={26} />
                      <span className="small">{a.name}</span>
                    </div>
                  ))}
                </div>
              )}
              {items.map((t) => {
                const agent = ws.agents.find((a) => a.id === t.assigneeId);
                const line = insert?.over === t.id && insert.before !== undefined ? ` insert-${insert.half}` : '';
                return (
                  // The title button is the keyboard/screen-reader way in; a click anywhere on the card does the same.
                  <article key={t.id} className={`card task-card${t.id === dragId ? ' dragging' : ''}${line}`} draggable
                    onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; setDragId(t.id); setConfirmCancel(null); }}
                    onDragEnd={endDrag}
                    onDragOver={(e) => overCard(e, t)}
                    onClick={() => setOpenId(t.id)}>
                    <div className="card-meta"><span>{t.id}</span><span style={{ marginLeft: 'auto' }}>{cardMeta(t, ws.tasks)}</span></div>
                    <button type="button" className="card-title card-open" aria-haspopup="dialog" onClick={(e) => { e.stopPropagation(); setOpenId(t.id); }}>{t.title}</button>
                    {(() => { const chip = modelChip(t); return chip && <span className="model-chip" title={chip.title}>{chip.label}</span>; })()}
                    <div className="row">
                      {agent && <Avatar look={lookFor(agent, roles)} size={22} />}
                      <span className="small">{agent?.name ?? 'unassigned'}</span>
                    </div>
                    {confirmCancel === t.id && (
                      <div className="card-confirm" role="group" aria-label={`Cancel ${t.id}?`} onClick={(e) => e.stopPropagation()}>
                        <span className="small">Cancel {t.id}?</span>
                        <button type="button" className="btn small danger" onClick={() => { setConfirmCancel(null); run(window.agentOffice.cancelTask(t.id)); }}>Cancel task</button>
                        <button type="button" className="btn small" onClick={() => setConfirmCancel(null)}>Keep</button>
                      </div>
                    )}
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
