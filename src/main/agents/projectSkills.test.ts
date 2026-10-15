import { describe, expect, it } from 'vitest';
import type { Project } from '../../shared/types';
import { applyBossPicks, applyUserEdit, projectSkillIds } from './projectSkills';

const base: Project = { id: 'p', name: 'p', repoPath: '/r', baseBranch: 'main', maxConcurrent: 4, autoMerge: false };
const known = new Set(Array.from({ length: 22 }, (_, i) => `s${i}`).concat(['docker', 'vue', 'react-patterns']));
const pick = (id: string, reason = 'why') => ({ id, reason });

describe('applyBossPicks', () => {
  it('sets the boss picks on an unchosen project', () => {
    const r = applyBossPicks(base, [pick('docker', ' containers '), pick('vue', '')], known);
    expect(r.skills).toEqual([
      { id: 'docker', reason: 'containers', addedBy: 'boss' },
      { id: 'vue', reason: 'Picked by the boss', addedBy: 'boss' },
    ]);
    expect(r).toMatchObject({ kept: [], skipped: [] });
  });

  it('keeps user entries, skips ids the user removed, and de-duplicates', () => {
    const p: Project = { ...base, skills: [{ id: 'vue', reason: 'Added by you', addedBy: 'user' }, { id: 's1', reason: 'old', addedBy: 'boss' }], skillsExcluded: ['docker'] };
    const r = applyBossPicks(p, [pick('docker'), pick('vue', 'boss says'), pick('s2'), pick('s2', 'twice')], known);
    expect(r.skills).toEqual([
      { id: 'vue', reason: 'Added by you', addedBy: 'user' },
      { id: 's2', reason: 'why', addedBy: 'boss' },
    ]);
    expect(r.kept).toEqual(['vue']);
    expect(r.skipped).toEqual([{ id: 'docker', why: 'removed by the user' }]);
  });

  it('rejects unknown ids and changes nothing', () => {
    expect(() => applyBossPicks(base, [pick('docker'), pick('nope'), pick('also-no')], known)).toThrow(/Unknown skills: nope, also-no/);
  });

  it('enforces the cap counting user entries', () => {
    const p: Project = { ...base, skills: [{ id: 's0', reason: 'x', addedBy: 'user' }, { id: 's1', reason: 'x', addedBy: 'user' }] };
    const picks = Array.from({ length: 11 }, (_, i) => pick(`s${i + 2}`));
    expect(() => applyBossPicks(p, picks, known)).toThrow('At most 12 skills per project; you picked 11 plus 2 added by the user');
    expect(applyBossPicks(p, picks.slice(0, 10), known).skills).toHaveLength(12);
  });

  it('clips long reasons to 160 code points', () => {
    const r = applyBossPicks(base, [pick('docker', '🙂'.repeat(200))], known);
    expect([...r.skills[0].reason]).toHaveLength(160);
  });

  it('drops stale user ids that are no longer in the library', () => {
    const p: Project = { ...base, skills: [{ id: 'gone', reason: 'x', addedBy: 'user' }] };
    expect(applyBossPicks(p, [pick('docker')], known).skills.map((s) => s.id)).toEqual(['docker']);
  });
});

describe('applyUserEdit', () => {
  it('starts from [] when unchosen; add marks user entries and clears exclusions', () => {
    const r = applyUserEdit({ ...base, skillsExcluded: ['docker'] }, { add: ['docker'] }, known);
    expect(r).toEqual({ skills: [{ id: 'docker', reason: 'Added by you', addedBy: 'user' }], skillsExcluded: [] });
    expect(applyUserEdit(base, {}, known)).toEqual({ skills: [], skillsExcluded: [] });
  });

  it('replaces a boss entry with a user entry when the user adds it', () => {
    const p: Project = { ...base, skills: [{ id: 'vue', reason: 'boss', addedBy: 'boss' }] };
    expect(applyUserEdit(p, { add: ['vue'] }, known).skills).toEqual([{ id: 'vue', reason: 'Added by you', addedBy: 'user' }]);
  });

  it('remove drops the entry and excludes the id once', () => {
    const p: Project = { ...base, skills: [{ id: 'vue', reason: 'boss', addedBy: 'boss' }], skillsExcluded: ['vue'] };
    expect(applyUserEdit(p, { remove: ['vue'] }, known)).toEqual({ skills: [], skillsExcluded: ['vue'] });
  });

  it('rejects unknown adds and enforces the cap', () => {
    expect(() => applyUserEdit(base, { add: ['nope'] }, known)).toThrow(/Unknown skills: nope/);
    const full: Project = { ...base, skills: Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, reason: 'x', addedBy: 'boss' as const })) };
    expect(() => applyUserEdit(full, { add: ['docker'] }, known)).toThrow(/At most 12 skills per project/);
    expect(applyUserEdit(full, { add: ['docker'], remove: ['s0'] }, known).skills).toHaveLength(12);
  });
});

describe('projectSkillIds', () => {
  it('lists ids, or none when unchosen', () => {
    expect(projectSkillIds(base)).toEqual([]);
    expect(projectSkillIds({ ...base, skills: [{ id: 'vue', reason: 'x', addedBy: 'user' }] })).toEqual(['vue']);
  });
});
