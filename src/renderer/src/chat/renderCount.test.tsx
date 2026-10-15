// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';

const renders = vi.hoisted(() => ({ n: 0 }));
vi.mock('react-markdown', () => ({ default: ({ children }: { children: string }) => { renders.n++; return <p>{children}</p>; } }));
const { Markdown } = await import('./Markdown');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Markdown', () => {
  it('does not re-render when its parent re-renders with the same text', async () => {
    let bump: () => void = () => undefined;
    function Parent() {
      const [n, setN] = useState(0);
      bump = () => setN((x) => x + 1);
      return <div data-n={n}>{Array.from({ length: 50 }, (_, i) => <Markdown key={i} text={`**m${i}**`} />)}</div>;
    }
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => { root.render(<Parent />); });
    const first = renders.n;
    expect(first).toBe(50);
    for (let i = 0; i < 10; i++) await act(async () => { bump(); });
    expect(renders.n).toBe(first);
    await act(async () => { root.unmount(); });
  });
});
