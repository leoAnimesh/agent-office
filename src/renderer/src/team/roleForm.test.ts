import { describe, expect, it } from 'vitest';
import { KNOWN_TOOLS, blankRole, roleIdFromName, toggle, toolChoices } from './roleForm';

describe('role form helpers', () => {
  it('toggles list items', () => {
    expect(toggle(['Read'], 'Edit')).toEqual(['Read', 'Edit']);
    expect(toggle(['Read', 'Edit'], 'Read')).toEqual(['Edit']);
  });

  it('derives a safe, unique role id from a name', () => {
    expect(roleIdFromName('Data Scientist', [])).toBe('data-scientist');
    expect(roleIdFromName('Data Scientist', ['data-scientist'])).toBe('data-scientist-2');
    expect(roleIdFromName('Data Scientist', ['data-scientist', 'data-scientist-2'])).toBe('data-scientist-3');
    expect(roleIdFromName('  ✨  ', [])).toBe('custom');
    expect(roleIdFromName('../../etc', [])).toBe('etc');
  });

  it('starts new roles on auto with every tool', () => {
    const r = blankRole();
    expect(r).toMatchObject({ id: '', model: 'auto', permissionMode: 'acceptEdits', allowedTools: KNOWN_TOOLS });
    expect(r.look.shirt).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it('offers known tools plus any custom ones the role already has', () => {
    expect(toolChoices({ ...blankRole(), allowedTools: ['Read', 'Bash(npm test:*)'] })).toEqual([...KNOWN_TOOLS, 'Bash(npm test:*)']);
  });
});
