import { describe, expect, it } from 'vitest';
import type { Project, Skill } from '../../../shared/types';
import { addableSkills, skillChips } from './projectSkills';

const p: Project = { id: 'p', name: 'p', repoPath: '/r', baseBranch: 'main', maxConcurrent: 4, autoMerge: false };
const sk = (id: string, name: string): Skill => ({ id, name, description: `${name} tips`, body: '- x', tags: [] });
const lib = [sk('vue', 'Vue'), sk('docker', 'Docker'), sk('a11y', 'Accessibility')];

describe('skillChips', () => {
  it('shows names and who added each, skipping ids missing from the library', () => {
    const chips = skillChips({ ...p, skills: [{ id: 'vue', reason: 'r', addedBy: 'boss' }, { id: 'gone', reason: 'r', addedBy: 'user' }, { id: 'docker', reason: 'Added by you', addedBy: 'user' }] }, lib);
    expect(chips).toEqual([{ id: 'vue', name: 'Vue', by: 'boss', reason: 'r' }, { id: 'docker', name: 'Docker', by: 'you', reason: 'Added by you' }]);
    expect(skillChips(p, lib)).toEqual([]);
  });
});

describe('addableSkills', () => {
  it('lists library skills not in the set, by name', () => {
    expect(addableSkills({ ...p, skills: [{ id: 'vue', reason: 'r', addedBy: 'boss' }] }, lib)).toEqual([
      { id: 'a11y', label: 'Accessibility — Accessibility tips' },
      { id: 'docker', label: 'Docker — Docker tips' },
    ]);
    expect(addableSkills(p, lib)).toHaveLength(3);
  });
});
