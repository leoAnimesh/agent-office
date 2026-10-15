import { useEffect, useState } from 'react';
import type { CommitDetail, CommitSummary, WorkspaceSnapshot } from '../../../shared/types';
import { splitPath } from '../chat/fileChanges';
import { diffLineKind, timeAgo } from '../history/format';
import { localStore, readProjectUi, writeProjectUi } from '../memory';

interface Props { ws: WorkspaceSnapshot; sha?: string; onError: (m: string) => void }

const PAGE = 100;

/** Read-only git history: what the team changed, commit by commit. Nothing here checks out or changes the repo. */
export function HistoryView({ ws, sha, onError }: Props) {
  const [branches, setBranches] = useState<string[]>([]);
  // The branch and filter the user last looked at in this project.
  const [remembered] = useState(() => readProjectUi(localStore(), ws.project.id));
  const [branch, setBranch] = useState(remembered.historyBranch ?? ws.project.baseBranch);
  const [mergesOnly, setMergesOnly] = useState(remembered.mergesOnly);
  const [commits, setCommits] = useState<CommitSummary[]>([]);
  const [more, setMore] = useState(false);
  const [selected, setSelected] = useState<string | null>(sha ?? null);
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const fail = (e: unknown) => onError(String(e));

  useEffect(() => {
    window.agentOffice.historyBranches().then((list) => {
      setBranches(list);
      // A remembered branch that was deleted since: fall back to the main branch.
      setBranch((b) => (list.includes(b) ? b : ws.project.baseBranch));
    }, fail);
  }, [ws.project.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { writeProjectUi(localStore(), ws.project.id, { historyBranch: branch, mergesOnly }); }, [ws.project.id, branch, mergesOnly]);

  const load = (skip: number) => window.agentOffice.historyList(branch, skip, mergesOnly).then((page) => {
    setCommits((prev) => (skip === 0 ? page : [...prev, ...page]));
    setMore(page.length === PAGE);
    if (skip === 0 && !sha) setSelected((cur) => cur ?? page[0]?.sha ?? null);
  }, fail);
  // New tasks merge in while the view is open: reload the list when the task list changes.
  const doneCount = ws.tasks.filter((t) => t.status === 'done').length;
  // Wait for the branch list before loading a remembered branch, which may have been deleted.
  const ready = branch === ws.project.baseBranch || branches.includes(branch);
  useEffect(() => { if (ready) void load(0); }, [branch, mergesOnly, doneCount, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setDetail(null); setFile(null); setDiff(null);
    if (selected) window.agentOffice.historyCommit(selected).then(setDetail, fail);
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const showFile = (path: string) => {
    if (!detail) return;
    setFile(path); setDiff(null);
    window.agentOffice.historyDiff(detail.sha, path).then(setDiff, fail);
  };
  const taskTitle = (id: string | null) => (id ? ws.tasks.find((t) => t.id === id)?.title : undefined);
  // A task merge is committed by whoever approved it; credit the teammate who did the work.
  const doneBy = (c: { taskId: string | null; author: string }) => {
    const task = c.taskId ? ws.tasks.find((t) => t.id === c.taskId) : undefined;
    return (task && ws.agents.find((a) => a.id === task.assigneeId)?.name) ?? c.author;
  };

  return (
    <div className="history">
      <section className="history-list" aria-label="Commits">
        <div className="row history-filters">
          <label htmlFor="hist-branch" className="small muted">Branch</label>
          <select id="hist-branch" className="input" value={branch} onChange={(e) => { setBranch(e.target.value); setSelected(null); }}>
            {(branches.length ? branches : [branch]).map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <label className="row small"><input type="checkbox" checked={mergesOnly} onChange={(e) => { setMergesOnly(e.target.checked); setSelected(null); }} style={{ width: 18, height: 18 }} /> Team merges only</label>
        </div>
        {commits.length === 0 && <p className="small muted">No commits to show.</p>}
        <ul className="commit-list">
          {commits.map((c) => (
            <li key={c.sha}>
              <button type="button" className="commit-row" aria-current={c.sha === selected ? 'true' : undefined} onClick={() => setSelected(c.sha)}>
                <span className="commit-subject">{c.taskId && <span className="chip">{c.taskId}</span>} {c.subject}</span>
                <span className="commit-meta mono small muted">
                  <span>{c.short}</span><span>{doneBy(c)}</span><span>{timeAgo(c.date)}</span>
                  <span className="commit-stat">{c.files} {c.files === 1 ? 'file' : 'files'} <span className="add">+{c.add}</span> <span className="del">−{c.del}</span></span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {more && <button type="button" className="btn small" onClick={() => void load(commits.length)}>Load more</button>}
      </section>

      <section className="history-detail" aria-label="Commit details">
        {!detail ? <p className="small muted">{selected ? 'Loading…' : 'Pick a commit.'}</p> : (
          <>
            <h2 className="history-title">{detail.subject}</h2>
            <p className="small muted" style={{ margin: 0 }}>
              {doneBy(detail) !== detail.author ? `${doneBy(detail)} (merged by ${detail.author})` : detail.author} · {new Date(detail.date).toLocaleString()} · <span className="mono">{detail.sha.slice(0, 10)}</span>
              {detail.parents > 1 && ' · merge'}{taskTitle(detail.taskId) && ` · task “${taskTitle(detail.taskId)}”`}
            </p>
            {detail.body && <p className="small pre history-body">{detail.body}</p>}
            <h3 className="history-files-title">{detail.files.length} {detail.files.length === 1 ? 'file' : 'files'} changed</h3>
            <ul className="history-files">
              {detail.files.map((f) => {
                const { name, dir } = splitPath(f.path);
                return (
                  <li key={f.path}>
                    <button type="button" className="history-file" aria-pressed={file === f.path} title={f.path} onClick={() => showFile(f.path)}>
                      {dir && <span className="fc-dir">{dir}</span>}<span className="fc-name">{name}</span>
                      <span className="fc-count"><span className="add">+{f.add}</span> <span className="del">−{f.del}</span></span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {file && (
              <section className="diff" aria-label={`Changes to ${file}`}>
                {diff === null ? <p className="small muted">Loading diff…</p> : (
                  <pre className="diff-body">{diff.split('\n').map((line, i) => <span key={i} className={`diff-line ${diffLineKind(line)}`}>{line || ' '}{'\n'}</span>)}</pre>
                )}
              </section>
            )}
          </>
        )}
      </section>
    </div>
  );
}
