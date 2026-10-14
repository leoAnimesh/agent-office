import { describe, expect, it } from 'vitest';
import { revealStep } from './reveal';

describe('revealStep', () => {
  it('types at a steady minimum pace', () => {
    expect(revealStep(0, 1000, 100, false)).toBeGreaterThanOrEqual(4);
  });

  it('catches up quickly on a big backlog, but never overshoots', () => {
    const after = revealStep(0, 600, 100, false);
    expect(after).toBeGreaterThanOrEqual(150);
    expect(revealStep(595, 600, 1000, false)).toBe(600);
  });

  it('drains any backlog within about half a second', () => {
    let shown = 0;
    for (let t = 0; t < 520; t += 16) shown = revealStep(shown, 2000, 16, false);
    expect(shown).toBe(2000);
  });

  it('shows everything at once when the user prefers reduced motion', () => {
    expect(revealStep(0, 500, 16, true)).toBe(500);
  });

  it('always moves forward at least one character', () => {
    expect(revealStep(10, 20, 0, false)).toBe(11);
  });
});
