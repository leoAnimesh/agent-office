import { describe, expect, it } from 'vitest';
import { FALLBACK_LOOK, STATUS_COLORS, STATUS_LABEL, clip, lookFor, spriteClass } from './sprite';
import type { AgentStatus, Role } from '../../../shared/types';

const statuses: AgentStatus[] = ['idle', 'thinking', 'working', 'waiting', 'done', 'error', 'paused'];

describe('sprite helpers', () => {
  it('has colours and a label for every status', () => {
    for (const s of statuses) {
      expect(STATUS_COLORS[s].dot).toMatch(/^#[0-9A-F]{6}$/i);
      expect(STATUS_LABEL[s].length).toBeGreaterThan(0);
      expect(spriteClass(s)).toBe(`sprite is-${s}`);
    }
  });

  it('uses the role look, or a neutral fallback', () => {
    const roles = [{ id: 'qa', look: { hair: '#111111', shirt: '#222222', skin: '#333333' } }] as Role[];
    expect(lookFor({ roleId: 'qa' }, roles)).toEqual({ hair: '#111111', shirt: '#222222', skin: '#333333' });
    expect(lookFor({ roleId: 'gone' }, roles)).toEqual(FALLBACK_LOOK);
  });

  it('clips long text with an ellipsis', () => {
    expect(clip('short', 10)).toBe('short');
    expect(clip('a'.repeat(50), 10)).toBe(`${'a'.repeat(9)}…`);
  });
});
