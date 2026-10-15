// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, useState, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';

const renders = vi.hoisted(() => ({ n: 0, entries: 0 }));
// Tool entries call describeToolCall on every render of the entry: a precise count of message re-renders.
vi.mock('./describe', () => ({ describeToolCall: () => { renders.entries++; return 'did a thing'; } }));
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
describe('BossChat', () => {
  const look = { hair: '#000000', shirt: '#000000', skin: '#000000' };
  const tools = Array.from({ length: 200 }, (_, i) => ({ kind: 'tool' as const, at: 't', tool: 'list_team', input: { i } }));
  const mount = async (el: ReactElement) => {
    (window as unknown as { agentOffice: unknown }).agentOffice = { sendToBoss: async () => undefined, answerMerge: async () => undefined, openExternal: async () => undefined };
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(el); });
    return { host, root, done: async () => { await act(async () => { root.unmount(); }); host.remove(); } };
  };

  it('typing does not re-render the conversation', async () => {
    const { BossChat } = await import('../components/BossChat');
    const m = await mount(<BossChat chat={tools} merges={[]} boss={undefined} bossLook={look} bossModel="opus" stream={null} busy={false} onError={() => undefined} />);
    const before = renders.entries;
    const box = m.host.querySelector('textarea')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    for (const ch of 'hello there, team') {
      await act(async () => { setValue.call(box, box.value + ch); box.dispatchEvent(new Event('input', { bubbles: true })); });
    }
    expect(box.value).toBe('hello there, team');
    expect(renders.entries).toBe(before);
    await m.done();
  });

  it('streaming re-renders only the streaming bubble', async () => {
    const { BossChat } = await import('../components/BossChat');
    const props = { chat: tools, merges: [], boss: undefined, bossLook: look, bossModel: 'opus', busy: true, onError: () => undefined };
    const m = await mount(<BossChat {...props} stream={null} />);
    const before = renders.entries;
    let text = '';
    for (let i = 0; i < 20; i++) {
      text += 'word ';
      await act(async () => { m.root.render(<BossChat {...props} stream={text} />); await new Promise((r) => setTimeout(r, 20)); });
    }
    expect(m.host.textContent).toContain('word word');
    expect(renders.entries).toBe(before);
    await m.done();
  });
});

describe('BossChat reply handoff', () => {
  it('shows the landed reply in place once its reveal has already caught up', async () => {
    const { BossChat } = await import('../components/BossChat');
    (window as unknown as { agentOffice: unknown }).agentOffice = { sendToBoss: async () => undefined, answerMerge: async () => undefined, openExternal: async () => undefined };
    const look = { hair: '#000000', shirt: '#000000', skin: '#000000' };
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const user = { kind: 'user' as const, at: 't', text: 'hi' };
    const base = { merges: [], boss: undefined, bossLook: look, bossModel: 'opus', busy: false, onError: () => undefined };
    await act(async () => { root.render(<BossChat {...base} chat={[user]} stream="Hello world" />); });
    await act(async () => { await new Promise((r) => setTimeout(r, 800)); }); // the reveal finishes before the reply lands
    await act(async () => { root.render(<BossChat {...base} chat={[user, { kind: 'boss', at: 't', text: 'Hello world' }]} stream={null} />); });
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
    expect(host.querySelector('.streaming')).toBeNull();
    expect(host.querySelector('.msg.boss')?.textContent).toContain('Hello world');
    await act(async () => { root.unmount(); });
    host.remove();
  });
});
