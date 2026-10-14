import { describe, expect, it } from 'vitest';
import { NO_UNSEEN, onMessages, onReachedBottom, onSent } from './unseen';

describe('unseen messages', () => {
  it('ignores new messages while the reader is at the bottom', () => {
    expect(onMessages(NO_UNSEEN, { prevCount: 3, count: 4, atBottom: true })).toEqual(NO_UNSEEN);
  });

  it('marks the first unseen message and counts the rest while scrolled up', () => {
    let s = onMessages(NO_UNSEEN, { prevCount: 3, count: 4, atBottom: false });
    expect(s).toEqual({ markerIndex: 3, count: 1 });
    s = onMessages(s, { prevCount: 4, count: 6, atBottom: false });
    expect(s).toEqual({ markerIndex: 3, count: 3 });
  });

  it('hides the counter at the bottom but keeps the marker until the user sends', () => {
    const s = onReachedBottom({ markerIndex: 3, count: 2 });
    expect(s).toEqual({ markerIndex: 3, count: 0 });
    expect(onSent(s)).toEqual(NO_UNSEEN);
  });

  it('starts a fresh marker for a new batch after the old one was read', () => {
    const read = onReachedBottom({ markerIndex: 3, count: 2 });
    expect(onMessages(read, { prevCount: 6, count: 7, atBottom: false })).toEqual({ markerIndex: 6, count: 1 });
  });

  it('ignores the history shrinking (e.g. a project switch)', () => {
    expect(onMessages({ markerIndex: 3, count: 1 }, { prevCount: 9, count: 2, atBottom: false })).toEqual(NO_UNSEEN);
  });
});
