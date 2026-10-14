import type { AppStatus } from '../shared/types';
import { claudeVersion, locateClaude, systemLocateEnv, type LocateEnv } from './claude/locate';

export interface AppStatusDeps {
  locate: LocateEnv;
  override?: string;
  version: (bin: string) => string | null;
}

export function getAppStatus(deps: AppStatusDeps = { locate: systemLocateEnv(), version: claudeVersion }): AppStatus {
  const bin = locateClaude(deps.locate, deps.override);
  return { platform: deps.locate.platform, claude: bin ? { path: bin, version: deps.version(bin) } : null };
}
