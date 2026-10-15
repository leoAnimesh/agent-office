import { MAX_PROJECT_SKILLS, type Project, type ProjectSkill } from '../../shared/types';
import { UserError } from './agentManager';

const clip = (s: string, n: number) => [...s].slice(0, n).join('');

function mustKnow(ids: string[], known: Set<string>): void {
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length > 0) throw new UserError(`Unknown skills: ${unknown.join(', ')}. Call list_skills for the ids.`);
}

export function projectSkillIds(p: Project): string[] {
  return (p.skills ?? []).map((s) => s.id);
}

/** The boss's picks replace its own earlier picks; the user's additions and removals always stand. */
export function applyBossPicks(current: Project, picks: { id: string; reason: string }[], known: Set<string>) {
  mustKnow(picks.map((p) => p.id), known);
  const user = (current.skills ?? []).filter((s) => s.addedBy === 'user' && known.has(s.id));
  const excluded = new Set(current.skillsExcluded ?? []);
  const taken = new Set(user.map((s) => s.id));
  const skipped: { id: string; why: string }[] = [];
  const boss: ProjectSkill[] = [];
  for (const p of picks) {
    if (excluded.has(p.id)) { if (!skipped.some((s) => s.id === p.id)) skipped.push({ id: p.id, why: 'removed by the user' }); continue; }
    if (taken.has(p.id)) continue;
    taken.add(p.id);
    boss.push({ id: p.id, reason: clip(p.reason.trim(), 160) || 'Picked by the boss', addedBy: 'boss' });
  }
  if (user.length + boss.length > MAX_PROJECT_SKILLS) {
    throw new UserError(`At most ${MAX_PROJECT_SKILLS} skills per project; you picked ${boss.length} plus ${user.length} added by the user`);
  }
  const kept = user.map((s) => s.id);
  return { skills: [...user, ...boss], kept, skipped };
}

export function applyUserEdit(current: Project, edit: { add?: string[]; remove?: string[] }, known: Set<string>) {
  const add = [...new Set(edit.add ?? [])];
  const remove = new Set(edit.remove ?? []);
  mustKnow(add, known);
  let skills = (current.skills ?? []).filter((s) => known.has(s.id) && !remove.has(s.id) && !add.includes(s.id));
  skills = [...skills, ...add.filter((id) => !remove.has(id)).map((id) => ({ id, reason: 'Added by you', addedBy: 'user' as const }))];
  if (skills.length > MAX_PROJECT_SKILLS) throw new UserError(`At most ${MAX_PROJECT_SKILLS} skills per project; remove one first`);
  const skillsExcluded = [...new Set([...(current.skillsExcluded ?? []).filter((id) => !add.includes(id)), ...remove])];
  return { skills, skillsExcluded };
}
