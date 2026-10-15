import { describe, expect, it } from 'vitest';
import { MODELS } from './roleForm';

describe('MODELS', () => {
  it('lists the boss models, strongest first', () => {
    expect(MODELS).toEqual(['opus', 'sonnet', 'haiku']);
  });
});
