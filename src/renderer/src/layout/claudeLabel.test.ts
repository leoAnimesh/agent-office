import { describe, expect, it } from 'vitest';
import { claudeLabel } from './claudeLabel';

describe('claudeLabel', () => {
  it('shows only the name and version', () => {
    expect(claudeLabel({ path: '/x/claude', version: '2.1.299' })).toEqual({ text: 'Claude Code v2.1.299', title: 'Claude Code v2.1.299 · connected' });
    expect(claudeLabel({ path: '/x/claude', version: null })).toEqual({ text: 'Claude Code', title: 'Claude Code · connected' });
  });
});
