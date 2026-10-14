import type { DiffStat } from '../../../shared/types';
import { fileTotals } from '../tasks/taskDetail';

export function splitPath(path: string): { name: string; dir: string } {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1;
  return { name: path.slice(cut), dir: path.slice(0, cut) };
}

const LEGACY = /^(T-\d+ by .+? finished (?:successfully|with problems)\.) Summary: ([\s\S]*?) Files: ([\s\S]*?)\. Read it with get_task, then request_merge or message_agent\.$/;

/** Chat history saved before task notices became markdown: the new shape, with the old "a (+1 −2), b (…)" list as files. */
export function legacyFinishedText(text: string): { text: string; files?: DiffStat[] } {
  const m = LEGACY.exec(text);
  if (!m) return { text };
  const summary = m[2].trim();
  const files = [...m[3].matchAll(/(?:^|, )(.+?) \(\+(\d+) −(\d+)\)/g)].map((f) => ({ path: f[1], add: Number(f[2]), del: Number(f[3]) }));
  return { text: summary ? `**${m[1]}**\n\n${summary}` : `**${m[1]}**`, files };
}

/** A task's changed files: totals you can expand into one row per file (name, folder, +/− counts). */
export function FileChanges({ files }: { files: DiffStat[] }) {
  if (files.length === 0) return null;
  const t = fileTotals(files);
  return (
    <details className="file-changes" open={files.length <= 5}>
      <summary>
        {t.files} {t.files === 1 ? 'file' : 'files'} changed <span className="add">+{t.add}</span> <span className="del">−{t.del}</span>
      </summary>
      <ul>
        {files.map((f) => {
          const { name, dir } = splitPath(f.path);
          return (
            <li key={f.path} title={f.path}>
              {dir && <span className="fc-dir">{dir}</span>}
              <span className="fc-name">{name}</span>
              <span className="fc-count"><span className="add">+{f.add}</span> <span className="del">−{f.del}</span></span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
