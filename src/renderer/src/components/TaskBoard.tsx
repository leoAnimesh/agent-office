import type { Agent, Task, TaskStatus } from '../../../shared/types';

const COLUMNS: { title: string; statuses: TaskStatus[] }[] = [
  { title: 'Queued', statuses: ['queued'] },
  { title: 'Working', statuses: ['working'] },
  { title: 'Needs help', statuses: ['needs_help', 'failed'] },
  { title: 'Review', statuses: ['review'] },
  { title: 'Done', statuses: ['done', 'cancelled'] },
];

export function TaskBoard({ tasks, agents, onError }: { tasks: Task[]; agents: Agent[]; onError: (m: string) => void }) {
  const who = (id: string) => agents.find((a) => a.id === id)?.name ?? '?';
  const act = (fn: () => Promise<void>) => () => { fn().catch((e: unknown) => onError(String(e))); };

  return (
    <section className="panel board" aria-label="Tasks">
      <h2>Tasks</h2>
      <div className="columns">
        {COLUMNS.map((c) => {
          const items = tasks.filter((t) => c.statuses.includes(t.status));
          return (
            <div key={c.title} className="column">
              <h3>{c.title} <span className="muted small">{items.length}</span></h3>
              {items.map((t) => (
                <article key={t.id} className="card">
                  <div className="mono small muted">{t.id} · {who(t.assigneeId)}{t.held ? ' · paused' : ''}{t.status === 'cancelled' ? ' · cancelled' : ''}</div>
                  <div className="card-title">{t.title}</div>
                  {t.resultSummary && (
                    <details>
                      <summary className="small">Result</summary>
                      <p className="small pre">{t.resultSummary}</p>
                      {t.diffStat && t.diffStat.length > 0 && (
                        <ul className="mono small files">{t.diffStat.map((f) => <li key={f.path}>{f.path} <span className="add">+{f.add}</span> <span className="del">−{f.del}</span></li>)}</ul>
                      )}
                    </details>
                  )}
                  <div className="card-actions">
                    {t.status === 'working' && <button type="button" onClick={act(() => window.agentOffice.pauseTask(t.id))}>Pause</button>}
                    {t.status === 'queued' && t.held && <button type="button" onClick={act(() => window.agentOffice.resumeTask(t.id))}>Resume</button>}
                    {['queued', 'working', 'needs_help', 'review'].includes(t.status) && (
                      <button type="button" className="danger" onClick={act(() => window.agentOffice.cancelTask(t.id))}>Cancel</button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}
