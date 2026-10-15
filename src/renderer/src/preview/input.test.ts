import { describe, expect, it } from 'vitest';
import { fitRect, keyToInput, statusLine, toFraction } from './input';

const k = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) =>
  ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

describe('fitRect / toFraction', () => {
  it('letterboxes the frame inside the box and maps clicks back to the page', () => {
    const r = fitRect(1000, 1000, 1280, 800);
    expect(r).toEqual({ x: 0, y: 187.5, w: 1000, h: 625 });
    expect(toFraction(500, 500, r)).toEqual({ x: 0.5, y: 0.5 });
    expect(toFraction(500, 100, r)).toBeNull();
  });
});

describe('keyToInput', () => {
  it('sends printable characters as text and named keys as keys', () => {
    expect(keyToInput(k('a'))).toEqual({ kind: 'text', text: 'a' });
    expect(keyToInput(k('Enter'))).toEqual({ kind: 'key', key: 'Enter' });
    expect(keyToInput(k('Tab', { shiftKey: true }))).toEqual({ kind: 'key', key: 'Shift+Tab' });
  });
  it('leaves app shortcuts and unknown keys alone', () => {
    expect(keyToInput(k('c', { metaKey: true }))).toBeNull();
    expect(keyToInput(k('`', { ctrlKey: true }))).toBeNull();
    expect(keyToInput(k('F5'))).toBeNull();
    expect(keyToInput(k('Shift'))).toBeNull();
  });
});

describe('statusLine', () => {
  it('says who, where and whether the dev server runs', () => {
    expect(statusLine({ agentId: 'a', url: 'http://127.0.0.1:5174/', title: 'App', devServer: { url: 'http://127.0.0.1:5174/', running: true } }, 'Pixel'))
      .toBe('Pixel · http://127.0.0.1:5174/ · dev server running');
    expect(statusLine({ agentId: 'a', url: 'about:blank', title: '', devServer: null }, 'Pixel')).toBe('Pixel · about:blank · no dev server');
  });
});
