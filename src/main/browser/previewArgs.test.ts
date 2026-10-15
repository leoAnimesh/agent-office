import { describe, expect, it } from 'vitest';
import { previewInput } from './previewArgs';

describe('previewInput', () => {
  it('accepts clicks, wheel, keys and text within limits', () => {
    expect(previewInput({ kind: 'click', x: 0.5, y: 1, button: 'left' })).toEqual({ kind: 'click', x: 0.5, y: 1, button: 'left' });
    expect(previewInput({ kind: 'wheel', x: 0, y: 0.2, dy: -120 })).toMatchObject({ kind: 'wheel', dy: -120 });
    expect(previewInput({ kind: 'key', key: 'Enter' })).toEqual({ kind: 'key', key: 'Enter' });
    expect(previewInput({ kind: 'text', text: 'héllo' })).toEqual({ kind: 'text', text: 'héllo' });
  });

  it('refuses anything else', () => {
    for (const bad of [null, 'click', { kind: 'click', x: 2, y: 0, button: 'left' }, { kind: 'click', x: 0, y: 0, button: 'middle' },
      { kind: 'wheel', x: 0, y: 0, dy: 99999 }, { kind: 'key', key: 'Meta+Q' }, { kind: 'text', text: 'x'.repeat(1001) }, { kind: 'eval', code: '1' },
      { kind: 'click', x: 0, y: 0, button: 'left', extra: 1 }])
      expect(() => previewInput(bad), JSON.stringify(bad)).toThrow();
  });
});
