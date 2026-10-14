import { spawnSync } from 'node:child_process';

export function mergePathLists(primary: string, extra: string, delimiter: string): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of [...primary.split(delimiter), ...extra.split(delimiter)]) {
    if (d && !seen.has(d)) { seen.add(d); out.push(d); }
  }
  return out.join(delimiter);
}

/** GUI apps on macOS/Linux start with a minimal PATH; ask the user's login shell for the real one. */
export function readLoginShellPath(shell = process.env.SHELL || '/bin/bash'): string | null {
  const r = spawnSync(shell, ['-ilc', 'printf "__AO_PATH__%s__AO_PATH__" "$PATH"'], { encoding: 'utf8', timeout: 5000 });
  const m = /__AO_PATH__([\s\S]*?)__AO_PATH__/.exec(r.stdout ?? '');
  return m ? m[1] : null;
}

export function fixGuiPath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): void {
  if (platform === 'win32') return;
  const login = readLoginShellPath();
  if (login) env.PATH = mergePathLists(env.PATH ?? '', login, ':');
}
