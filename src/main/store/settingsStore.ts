import type { AppSettings } from '../../shared/types';
import { readJson, writeJsonAtomic } from './jsonStore';
import { parseOrThrow, settingsSchema } from './validate';

export const DEFAULT_SETTINGS: AppSettings = { claudePath: null, isolateUserSettings: true };

export class SettingsStore {
  /** `isProgram` checks that a configured Claude path really points at a program. */
  constructor(private readonly file: string, private readonly isProgram?: (p: string) => boolean) {}

  async get(): Promise<AppSettings> {
    const parsed = settingsSchema.safeParse(await readJson<unknown>(this.file, {}));
    // A hand-edited or corrupt file must never break startup: fall back to the defaults.
    return parsed.success ? ({ ...DEFAULT_SETTINGS, ...parsed.data } as AppSettings) : { ...DEFAULT_SETTINGS };
  }

  async save(patch: Partial<AppSettings>): Promise<AppSettings> {
    const clean = parseOrThrow(settingsSchema, patch, 'settings');
    if (clean.claudePath && this.isProgram && !this.isProgram(clean.claudePath)) {
      throw new Error(`No Claude Code program at ${clean.claudePath}`);
    }
    const next: AppSettings = { ...(await this.get()), ...clean } as AppSettings;
    await writeJsonAtomic(this.file, next);
    return next;
  }
}
