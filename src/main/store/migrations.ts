import { AUTO_MODEL } from '../../shared/types';
import { ALL_TOOLS } from '../../shared/tools';
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

/** One-time: every employee role pre-approves every tool. Extras are kept; a tool unticked afterwards stays off. */
export async function migrateRolesAllTools(roles: RoleStore, settings: SettingsStore): Promise<number> {
  if ((await settings.get()).allToolsMigrated) return 0;
  let changed = 0;
  for (const r of await roles.list()) {
    if (r.id === 'boss') continue;
    const missing = ALL_TOOLS.filter((t) => !r.allowedTools.includes(t));
    if (missing.length === 0) continue;
    await roles.save({ ...r, allowedTools: [...r.allowedTools, ...missing] });
    changed++;
  }
  await settings.save({ allToolsMigrated: true });
  return changed;
}
