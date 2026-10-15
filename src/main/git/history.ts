import type { CommitDetail, CommitSummary, DiffStat } from '../../shared/types';
import { git } from './worktrees';

/** Read-only views of the project's git history. Refs, hashes and paths come from the renderer, so each is checked. */

const SEP = '\x1f';
const REC = '\x1e';
const SHA = /^[0-9a-f]{7,40}$/;
const MAX_DIFF = 400 * 1024;

const taskIdOf = (subject: string) => /^Merge (T-\d+):/.exec(subject)?.[1] ?? null;

function numstat(lines: string[]): DiffStat[] {
  return lines.map((l) => l.split('\t')).filter((p) => p.length >= 3).map(([a, d, ...rest]) => ({
    // Binary files report "-": count them as 0 lines.
    path: rest.join('\t'), add: Number(a) || 0, del: Number(d) || 0,
  }));
}

/** Local branches, the checked-out one first. */
export async function listBranches(repo: string): Promise<string[]> {
  const current = await git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '');
  const all = (await git(repo, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])).split(/\r?\n/).filter(Boolean);
  return [...all.filter((b) => b === current), ...all.filter((b) => b !== current).sort()];
}

/**
 * Commits on a branch, newest first, following first parents so a merged task is one entry whose numbers are
 * what it brought in.
 */
export async function listCommits(repo: string, ref: string, opts: { skip?: number; limit?: number; mergesOnly?: boolean }): Promise<CommitSummary[]> {
  if (!(await listBranches(repo)).includes(ref)) throw new Error(`Unknown branch: ${ref}`);
  const skip = Math.max(0, Math.floor(opts.skip ?? 0));
  const limit = Math.min(200, Math.max(1, Math.floor(opts.limit ?? 100)));
  const out = await git(repo, [
    'log', ref, '--first-parent', '--diff-merges=first-parent', '--numstat', `--skip=${skip}`, '-n', String(limit),
    `--format=${REC}%H${SEP}%h${SEP}%s${SEP}%an${SEP}%aI${SEP}%P`, ...(opts.mergesOnly ? ['--merges'] : []), '--',
  ]);
  return out.split(REC).filter((c) => c.trim()).map((chunk) => {
    const [head, ...rest] = chunk.split(/\r?\n/);
    const [sha, short, subject, author, date, parents] = head.split(SEP);
    const files = numstat(rest.filter(Boolean));
    return {
      sha, short, subject, author, date, isMerge: parents.trim().split(' ').length > 1, taskId: taskIdOf(subject),
      files: files.length, add: files.reduce((n, f) => n + f.add, 0), del: files.reduce((n, f) => n + f.del, 0),
    };
  });
}

async function mustCommit(repo: string, sha: string): Promise<void> {
  if (!SHA.test(sha)) throw new Error('Not a commit hash');
  await git(repo, ['cat-file', '-e', `${sha}^{commit}`]).catch(() => { throw new Error(`Unknown commit ${sha}`); });
}

export async function commitDetail(repo: string, sha: string): Promise<CommitDetail> {
  await mustCommit(repo, sha);
  const head = await git(repo, ['show', '-s', `--format=%H${SEP}%s${SEP}%an${SEP}%ae${SEP}%aI${SEP}%P${SEP}%b`, sha]);
  const [full, subject, author, email, date, parents, ...body] = head.split(SEP);
  const files = numstat((await git(repo, ['show', '--format=', '--numstat', '--diff-merges=first-parent', sha])).split(/\r?\n/).filter(Boolean));
  return { sha: full, subject, body: body.join(SEP).trim(), author, email, date, parents: parents.trim().split(' ').filter(Boolean).length, taskId: taskIdOf(subject), files };
}

/** One file's diff in a commit (against its first parent), capped in size. */
export async function fileDiff(repo: string, sha: string, file: string): Promise<string> {
  const { files } = await commitDetail(repo, sha);
  if (!files.some((f) => f.path === file)) throw new Error(`${file} was not changed in this commit`);
  const diff = await git(repo, ['show', '--format=', '--no-color', '--diff-merges=first-parent', sha, '--', file]);
  return diff.length > MAX_DIFF ? `${diff.slice(0, MAX_DIFF)}\n\n… diff cut at ${MAX_DIFF / 1024} KB` : diff;
}
