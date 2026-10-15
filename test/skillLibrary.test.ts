import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { SkillStore } from '../src/main/store/skillStore';

const IDS = [
  'a11y-checklist', 'react-patterns', 'nextjs', 'vue', 'css-tailwind', 'typescript', 'api-design', 'node-express',
  'python-backend', 'go-services', 'sql-databases', 'auth-security', 'security-review', 'testing-basics',
  'e2e-playwright', 'performance', 'docker', 'github-actions', 'react-native', 'python-data', 'docs-style', 'git-hygiene',
];

describe('built-in skill library', () => {
  it('has the 22 skills, each with a name, description, tags and guidance', async () => {
    const skills = await new SkillStore(path.resolve('resources/skills')).list();
    expect(skills.map((s) => s.id).sort()).toEqual([...IDS].sort());
    for (const s of skills) {
      expect(s.name, s.id).not.toBe(s.id);
      expect(s.description.length, s.id).toBeGreaterThan(0);
      expect(s.tags.length, s.id).toBeGreaterThan(0);
      expect(s.body.split('\n').filter((l) => l.startsWith('- ')).length, s.id).toBeGreaterThanOrEqual(4);
    }
  });
});
