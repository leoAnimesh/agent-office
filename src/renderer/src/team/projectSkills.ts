import type { Project, Skill } from '../../../shared/types';

/** Chips for the project's skills; ids no longer in the library are left out. */
export function skillChips(p: Project, lib: Skill[]): { id: string; name: string; by: 'boss' | 'you'; reason: string }[] {
  const byId = new Map(lib.map((s) => [s.id, s]));
  return (p.skills ?? []).flatMap((s) => {
    const skill = byId.get(s.id);
    return skill ? [{ id: s.id, name: skill.name, by: s.addedBy === 'user' ? 'you' as const : 'boss' as const, reason: s.reason }] : [];
  });
}

/** Library skills the user can still add, by name. */
export function addableSkills(p: Project, lib: Skill[]): { id: string; label: string }[] {
  const taken = new Set((p.skills ?? []).map((s) => s.id));
  return lib.filter((s) => !taken.has(s.id)).sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => ({ id: s.id, label: s.description ? `${s.name} — ${s.description}` : s.name }));
}
