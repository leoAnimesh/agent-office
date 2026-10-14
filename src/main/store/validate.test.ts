import { describe, expect, it } from 'vitest';
import { parseOrThrow, projectPatchSchema, roleSchema, settingsSchema, skillSchema } from './validate';

const role = { id: 'frontend', name: 'Frontend Engineer', blurb: 'UI', systemPrompt: 'Be good.', skills: ['react-patterns'], model: 'sonnet', permissionMode: 'acceptEdits', allowedTools: ['Read'], look: { hair: '#E2583E', shirt: '#2F9E8F', skin: '#F1C9A5' } };

describe('validation', () => {
  it('accepts a valid role and rejects unsafe or broken ones', () => {
    expect(parseOrThrow(roleSchema, role, 'role')).toEqual(role);
    expect(() => parseOrThrow(roleSchema, { ...role, id: '../x' }, 'role')).toThrow(/Invalid role: id/);
    expect(() => parseOrThrow(roleSchema, { ...role, name: '' }, 'role')).toThrow(/Invalid role: name/);
    expect(() => parseOrThrow(roleSchema, { ...role, look: { ...role.look, shirt: 'red' } }, 'role')).toThrow(/look\.shirt/);
    expect(() => parseOrThrow(roleSchema, { ...role, permissionMode: 'yolo' }, 'role')).toThrow(/permissionMode/);
    expect(() => parseOrThrow(roleSchema, { ...role, allowedTools: [] }, 'role')).toThrow(/allowedTools/);
  });

  it('checks project settings ranges', () => {
    expect(parseOrThrow(projectPatchSchema, { maxConcurrent: 3, autoMerge: true }, 'settings')).toEqual({ maxConcurrent: 3, autoMerge: true });
    for (const bad of [0, 9, 2.5, 'abc']) expect(() => parseOrThrow(projectPatchSchema, { maxConcurrent: bad }, 'settings')).toThrow(/maxConcurrent/);
    expect(() => parseOrThrow(projectPatchSchema, { repoPath: '/etc' }, 'settings')).toThrow();
  });

  it('checks skills and app settings', () => {
    expect(parseOrThrow(skillSchema, { id: 'my-skill', name: 'Mine', description: '', body: 'Do x.' }, 'skill').id).toBe('my-skill');
    expect(() => parseOrThrow(skillSchema, { id: 'Bad Id', name: 'x', description: '', body: 'b' }, 'skill')).toThrow(/id/);
    expect(parseOrThrow(settingsSchema, { claudePath: null }, 'settings')).toEqual({ claudePath: null });
    expect(() => parseOrThrow(settingsSchema, { isolateUserSettings: 'yes' }, 'settings')).toThrow();
  });
});
