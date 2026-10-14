import type { AppSettings } from '../../shared/types';
import { readJson, writeJsonAtomic } from './jsonStore';
import { parseOrThrow, settingsSchema } from './validate';

export const DEFAULT_SETTINGS: AppSettings = { claudePath: null, isolateUserSettings: true };

export class SettingsStore {
  constructor(private readonly file: string) {}

  async get(): Promise<AppSettings> {
    return { ...DEFAULT_SETTINGS, ...(await readJson<Partial<AppSettings>>(this.file, {})) };
  }

  async save(patch: Partial<AppSettings>): Promise<AppSettings> {
    const clean = parseOrThrow(settingsSchema, patch, 'settings');
    const next: AppSettings = { ...(await this.get()), ...clean } as AppSettings;
    await writeJsonAtomic(this.file, next);
    return next;
  }
}
