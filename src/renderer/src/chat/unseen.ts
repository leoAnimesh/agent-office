/** Where the "New messages" divider sits and how many messages arrived since the reader scrolled away. */
export interface Unseen { markerIndex: number | null; count: number }

export const NO_UNSEEN: Unseen = { markerIndex: null, count: 0 };

export function onMessages(s: Unseen, e: { prevCount: number; count: number; atBottom: boolean }): Unseen {
  if (e.count < e.prevCount) return NO_UNSEEN;
  const added = e.count - e.prevCount;
  if (added === 0 || e.atBottom) return s;
  // A new batch after the last one was read starts a new marker.
  const markerIndex = s.markerIndex === null || s.count === 0 ? e.prevCount : s.markerIndex;
  return { markerIndex, count: s.count + added };
}

export function onReachedBottom(s: Unseen): Unseen {
  return s.count === 0 ? s : { ...s, count: 0 };
}

export function onSent(_s: Unseen): Unseen {
  return NO_UNSEEN;
}
