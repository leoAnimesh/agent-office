import type { Role } from '../../../shared/types';

export const KNOWN_TOOLS = ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'NotebookEdit'];
export const MODELS = ['opus', 'sonnet', 'haiku'];

export function toggle(list: string[], item: string): string[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

export function roleIdFromName(name: string, taken: string[]): string {
  const base = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'custom';
  if (!taken.includes(base)) return base;
  for (let i = 2; ; i++) if (!taken.includes(`${base}-${i}`)) return `${base}-${i}`;
}

export function blankRole(): Role {
  return {
    id: '', name: '', blurb: '', systemPrompt: '', skills: ['git-hygiene'], model: 'auto', permissionMode: 'acceptEdits',
    allowedTools: ['Read', 'Edit', 'Write', 'Grep', 'Glob'], look: { hair: '#8A4B2A', shirt: '#3E8E5A', skin: '#F1C9A5' },
  };
}

export function toolChoices(role: Role): string[] {
  return [...KNOWN_TOOLS, ...role.allowedTools.filter((t) => !KNOWN_TOOLS.includes(t))];
}
