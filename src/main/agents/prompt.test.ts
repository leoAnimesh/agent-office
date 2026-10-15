import { describe, expect, it } from 'vitest';
import { renderPrompt, taskMessage } from './prompt';
import type { Role, Task } from '../../shared/types';

const role: Role = { id: 'frontend', name: 'Frontend Engineer', blurb: '', systemPrompt: 'Be a great FE.', skills: ['react-patterns'], model: 'sonnet', permissionMode: 'acceptEdits', allowedTools: ['Read'], look: { hair: '#000000', shirt: '#000000', skin: '#000000' } };

describe('renderPrompt', () => {
  it('includes identity, role prompt, skills and rules in order', () => {
    const out = renderPrompt(role, [{ id: 'react-patterns', name: 'React patterns', description: 'd', body: 'Use hooks.', tags: [] }], {
      agentName: 'Pixel', bossName: 'Max', branch: 'ao/pixel/x', projectName: 'demo', kind: 'employee',
    });
    expect(out).toContain('You are Pixel, the Frontend Engineer on the "demo" team. Your boss is Max.');
    const order = ['Be a great FE.', '## Skills', '### React patterns', 'Use hooks.', '## Rules', 'ao/pixel/x'];
    let last = -1;
    for (const s of order) {
      const i = out.indexOf(s);
      expect(i, s).toBeGreaterThan(last);
      last = i;
    }
  });

  it('omits the skills section when there are none', () => {
    const out = renderPrompt(role, [], { agentName: 'Pixel', bossName: 'Max', branch: 'b', projectName: 'demo', kind: 'employee' });
    expect(out).not.toContain('## Skills');
  });
});

describe('renderPrompt (boss)', () => {
  it('gives the boss delegation rules and no worktree rules', () => {
    const out = renderPrompt({ ...role, name: 'Boss', systemPrompt: 'Lead.' }, [], { agentName: 'Max', bossName: 'Max', branch: 'main', projectName: 'demo', kind: 'boss' });
    expect(out).toContain('You are Max, the boss of the "demo" team in AgentOffice.');
    expect(out).toContain('## How you work');
    expect(out).toContain('assign_task');
    expect(out).not.toContain('## Rules');
  });
});

describe('taskMessage', () => {
  const task = { id: 'T-101', title: 'Add toggle', brief: 'Make a toggle.', attempts: 0 } as Task;
  it('sends the full brief on the first attempt', () => {
    expect(taskMessage(task)).toBe('# Task T-101: Add toggle\n\nMake a toggle.\n\nWhen you are finished, reply with a short summary (at most 5 lines) of what you changed and how you verified it.');
  });
  it('asks to continue on later attempts', () => {
    const msg = taskMessage({ ...task, attempts: 2 });
    expect(msg).toMatch(/^Continue working on task T-101 \("Add toggle"\)/);
    expect(msg).toContain('Make a toggle.');
  });
});
