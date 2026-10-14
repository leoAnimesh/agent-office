import { AUTO_MODEL } from '../../shared/types';
import type { RoleStore } from './roleStore';
import type { SettingsStore } from './settingsStore';

/** One-time: employee roles move to per-task model picking. Roles pinned afterwards stay pinned. */
export async function migrateRolesToAuto(roles: RoleStore, settings: SettingsStore): Promise<number> {
  if ((await settings.get()).autoModelMigrated) return 0;
  let changed = 0;
  for (const r of await roles.list()) {
    if (r.id === 'boss' || r.model === AUTO_MODEL) continue;
    await roles.save({ ...r, model: AUTO_MODEL });
    changed++;
  }
  await settings.save({ autoModelMigrated: true });
  return changed;
}
