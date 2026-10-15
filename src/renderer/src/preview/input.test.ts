import { describe, expect, it } from 'vitest';
import { emptyState, fitRect, keyToInput, statusLine, toFraction, wheelGate } from './input';

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
    // Tab and Shift+Tab move focus out of the live view (no keyboard trap).
    expect(keyToInput(k('Tab'))).toBeNull();
    expect(keyToInput(k('Tab', { shiftKey: true }))).toBeNull();
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
    expect(statusLine({ agentId: 'a', url: '', title: '', devServer: { url: 'http://127.0.0.1:6000/', running: true } }, 'Pixel')).toBe('Pixel · no page open · dev server running at http://127.0.0.1:6000/');
  });
});

describe('emptyState', () => {
  it('tells the user to install a browser when none can start, otherwise waits for a tab', () => {
    expect(emptyState(false)).toEqual({ text: 'No browser found. Install Google Chrome or Microsoft Edge, then try again.', install: true });
    expect(emptyState(true)).toEqual({ text: "An employee's browser tab appears here when it starts testing.", install: false });
    expect(emptyState(null)).toEqual({ text: "An employee's browser tab appears here when it starts testing.", install: false });
  });
});

describe('wheelGate', () => {
  it('lets one device swipe through per 400 ms of scrolling', () => {
    const gate = wheelGate(400);
    expect(gate(1000)).toBe(true);
    expect(gate(1100)).toBe(false);
    expect(gate(1399)).toBe(false);
    expect(gate(1400)).toBe(true);
  });
});
