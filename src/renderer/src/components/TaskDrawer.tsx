import { useEffect, useRef, useState } from 'react';
import type { Role, Task, WorkspaceSnapshot } from '../../../shared/types';
import { FileChanges } from '../chat/fileChanges';
import { Markdown } from '../chat/Markdown';
import { Avatar } from '../sprites/Avatar';
import { lookFor } from '../sprites/sprite';
import { cardMeta } from '../tasks/board';
import { chipDetail, modelChip } from '../tasks/modelChip';
import { canReassign, fileTotals, queueNeighbours, taskActions } from '../tasks/taskDetail';

interface Props { task: Task; ws: WorkspaceSnapshot; roles: Role[]; onClose: () => void; onOpenAgent: (id: string) => void; onError: (m: string) => void }

const when = (iso: string) => (iso ? new Date(iso).toLocaleString() : '—');

/** Task details in a slide-over. A native modal <dialog>: Esc closes, focus stays inside, the board behind is inert. */
export function TaskDrawer({ task, ws, roles, onClose, onOpenAgent, onError }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => { opener?.focus?.(); };
  }, []);

  const agent = ws.agents.find((a) => a.id === task.assigneeId);
  const chip = modelChip(task);
  const totals = fileTotals(task.diffStat);
  const act = (fn: () => Promise<void>) => () => { fn().catch((e: unknown) => onError(String(e))); };
  const nb = queueNeighbours(task, ws.tasks);
  const others = ws.agents.filter((a) => a.kind === 'employee' && a.id !== task.assigneeId);
  const [assignTo, setAssignTo] = useState(others[0]?.name ?? '');
  const copyBranch = () => { navigator.clipboard.writeText(task.branch).catch((e: unknown) => onError(`Could not copy: ${String(e)}`)); };

  return (
    <dialog ref={ref} className="drawer" aria-labelledby="drawer-title" onClose={onClose} onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}>
      <div className="drawer-body">
        <div className="drawer-head">
          <span className="mono small muted">{task.id} · {cardMeta(task, ws.tasks)}</span>
          <button type="button" className="btn small" style={{ marginLeft: 'auto' }} onClick={() => ref.current?.close()}>Close</button>
        </div>
        <h2 id="drawer-title" className="drawer-title">{task.title}</h2>
        {chip && <p className="small muted" style={{ margin: 0 }} title={chip.title}>{chipDetail(chip)}</p>}

        <div className="row">
          {agent && <Avatar look={lookFor(agent, roles)} size={22} />}
          {agent ? <button type="button" className="btn small" onClick={() => { ref.current?.close(); onOpenAgent(agent.id); }}>{agent.name}</button> : <span className="small muted">unassigned</span>}
          <span className="small muted">from {task.createdBy === 'boss' ? 'the boss' : 'you'}</span>
        </div>

        <div className="row branch-row">
          <span className="mono small branch" title={task.branch}>{task.branch}</span>
          <button type="button" className="btn small" onClick={copyBranch}>Copy</button>
        </div>

        {task.dependsOn.length > 0 && <p className="small" style={{ margin: 0 }}><span className="muted">Depends on </span><span className="mono">{task.dependsOn.join(', ')}</span></p>}

        <section className="drawer-section" aria-label="Brief">
          <h3>Brief</h3>
          <div className="drawer-md"><Markdown text={task.brief} /></div>
        </section>

        {task.resultSummary && (
          <section className="drawer-section" aria-label="Result">
            <h3>Result</h3>
            <div className="drawer-md"><Markdown text={task.resultSummary} /></div>
          </section>
        )}

        {totals.files > 0 && (
          <section className="drawer-section" aria-label="Files changed">
            <h3>Files changed</h3>
            <FileChanges files={task.diffStat!} open />
          </section>
        )}

        <dl className="meta">
          <div><dt>Created</dt><dd>{when(task.createdAt)}</dd></div>
          <div><dt>Updated</dt><dd>{when(task.updatedAt)}</dd></div>
        </dl>

        {task.status === 'queued' && (
          // The keyboard way to do what dragging does on the board.
          <section className="drawer-section" aria-label="Queue">
            <h3>Queue</h3>
            <div className="row">
              <button type="button" className="btn small" disabled={!nb.canUp} onClick={act(() => window.agentOffice.moveTask(task.id, nb.up))}>Move up</button>
              <button type="button" className="btn small" disabled={!nb.canDown} onClick={act(() => window.agentOffice.moveTask(task.id, nb.down))}>Move down</button>
            </div>
            {canReassign(task) && others.length > 0 && (
              <div className="row">
                <label htmlFor="drawer-assign" className="small">Assign to</label>
                <select id="drawer-assign" className="input" value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
                  {others.map((a) => <option key={a.id} value={a.name}>{a.name}</option>)}
                </select>
                <button type="button" className="btn small" onClick={act(() => window.agentOffice.reassignTask(task.id, assignTo))}>Assign</button>
              </div>
            )}
          </section>
        )}

        {taskActions(task).length > 0 && (
          <div className="row drawer-actions">
            {taskActions(task).map((a) => {
              if (a === 'merge') return <button key={a} type="button" className="btn small primary" onClick={act(() => window.agentOffice.mergeNow(task.id))}>Merge now</button>;
              if (a === 'cancel') return <button key={a} type="button" className="btn small danger" onClick={act(() => window.agentOffice.cancelTask(task.id))}>Cancel task</button>;
              return <button key={a} type="button" className="btn small" onClick={act(() => (a === 'pause' ? window.agentOffice.pauseTask(task.id) : window.agentOffice.resumeTask(task.id)))}>{a === 'pause' ? 'Pause' : 'Resume'}</button>;
            })}
          </div>
        )}
      </div>
    </dialog>
  );
}
