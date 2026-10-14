/** Hooks for tests and development. Packaged builds ignore all of them. */
export interface TestOverrides {
  userData?: string;
  claudeBin?: string;
  claudeArgs: string[];
  claudeMissing: boolean;
  pickFolder?: string;
  rendererUrl?: string;
}

export function readTestOverrides(env: Record<string, string | undefined>, isPackaged: boolean): TestOverrides {
  if (isPackaged) return { claudeArgs: [], claudeMissing: false };
  let claudeArgs: string[] = [];
  try {
    const v: unknown = JSON.parse(env.AO_CLAUDE_ARGS ?? '[]');
    if (Array.isArray(v)) claudeArgs = v.filter((x): x is string => typeof x === 'string');
  } catch { /* ignore broken JSON */ }
  const o: TestOverrides = { claudeArgs, claudeMissing: env.AO_CLAUDE_MISSING === '1' };
  if (env.AO_USER_DATA) o.userData = env.AO_USER_DATA;
  if (env.AO_CLAUDE_BIN) o.claudeBin = env.AO_CLAUDE_BIN;
  if (env.AO_E2E_PICK_FOLDER) o.pickFolder = env.AO_E2E_PICK_FOLDER;
  if (env.ELECTRON_RENDERER_URL) o.rendererUrl = env.ELECTRON_RENDERER_URL;
  return o;
}
