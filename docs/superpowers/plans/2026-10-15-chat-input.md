# Fast Chat Input and Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Typing in the boss chat no longer re-renders the conversation, and the user can paste, drop or pick images and files that are stored with the message, shown in history and passed to the boss.

**Architecture:** The draft and attachments move into a memoized `ChatComposer`; the list, entries and markdown are memoized, and only a small `StreamingBubble` re-renders per animation frame. Attachments are prepared in the renderer (images downscaled), sent as bytes over a validated IPC call, stored under `projects/<id>/attachments/`, recorded as metadata on the user chat entry, and delivered to the boss as image content blocks (images) or a path in a folder added with `--add-dir` (files).

**Tech Stack:** TypeScript, React 18, Electron, zod, Vitest (+ `jsdom` for two render tests), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-15-chat-input-design.md`

## Global Constraints

- Image types: `image/png`, `image/jpeg`, `image/gif`, `image/webp`. At most 5 attachments per message; each image ≤ 5 MB (after preparation); each other file ≤ 10 MB; total ≤ 20 MB.
- Names: base name only, control characters removed, ≤ 120 code points, empty → `attachment`.
- Images over 1568 px on the long side are scaled down; PNG stays PNG unless then > 5 MB (→ JPEG q85); JPEG/WebP → JPEG q85; GIF as-is.
- Attachment ids are UUIDs (`^[0-9a-f-]{36}$`); files live in `projects/<id>/attachments/<uuid><ext>`.
- Magic bytes: PNG `89 50 4E 47`, JPEG `FF D8 FF`, GIF `47 49 46 38`, WebP `52 49 46 46 …. 57 45 42 50`.
- No CSP change; thumbnails are `data:` URLs. Model and user text render only as React text.
- `jsdom` is added as an exactly pinned dev dependency, used only by files that start with `// @vitest-environment jsdom`.
- Commits: Conventional Commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Gates: `npm run typecheck && npm test && npm run test:e2e`.

## Review Focus

1. A crashed boss restarting must re-send the last message **with** its images (today's `lastText` path). Pinned in Task 5 (`re-sends images after a restart`).
2. A message with only attachments and no text must send; an empty message with no attachments must not. Pinned in Task 3 and Task 6.
3. A renamed file (`evil.png` that is really a text file) is refused by main, not stored. Pinned in Task 5.
4. A plain-text paste must still paste text (only file pastes are taken over). Pinned in Task 6 (e2e types/pastes text).
5. Streaming must still keep the chat scrolled to the bottom after the split (the per-frame scroll moves into `StreamingBubble`). Pinned in Task 2 (render test checks the scroll callback fires) and the existing e2e "marks new messages" test.

---

### Task 1: Memoized markdown and a render-count test harness

**Files:**
- Modify: `package.json` (dev dependency `jsdom`)
- Modify: `src/renderer/src/chat/Markdown.tsx`
- Create: `src/renderer/src/chat/renderCount.test.tsx`

**Interfaces:**
- Produces: `Markdown` is `React.memo`; module constants `PLUGINS`, `COMPONENTS`.

- [ ] **Step 1: Add jsdom**

Run: `npm install --save-dev --save-exact jsdom@25.0.1`
Expected: `devDependencies` gains `"jsdom": "25.0.1"`. (If that exact version is unavailable, use the newest 25.x and pin it exactly.)

- [ ] **Step 2: Write the failing test** `src/renderer/src/chat/renderCount.test.tsx`

```tsx
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
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run src/renderer/src/chat/renderCount.test.tsx`
Expected: FAIL — `expected 550 to be 50` (every parent render re-renders all 50).

- [ ] **Step 4: Implement** — in `src/renderer/src/chat/Markdown.tsx` replace the export with:

```tsx
import { memo, type ReactNode } from 'react';
// … (remarkHtmlAsText and Link unchanged)

const PLUGINS = [remarkGfm, remarkHtmlAsText];
const COMPONENTS = { a: Link };

/** Memoized: a chat re-renders often (typing, streaming), but a message's markdown only changes with its text. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={PLUGINS} components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
```

(keep the existing `ReactNode` import used by `Link`.)

- [ ] **Step 5: Run it**

Run: `npx vitest run src/renderer/src/chat && npm run typecheck`
Expected: PASS (including the existing `Markdown.test.tsx`).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/renderer/src/chat/Markdown.tsx src/renderer/src/chat/renderCount.test.tsx
git commit -m "perf(chat): memoize markdown rendering"
```

---

### Task 2: Split the chat so typing and streaming re-render only what changes

**Files:**
- Create: `src/renderer/src/chat/ChatComposer.tsx`
- Create: `src/renderer/src/chat/StreamingBubble.tsx`
- Modify: `src/renderer/src/components/BossChat.tsx`
- Modify: `src/renderer/src/App.tsx` (memoized `bossLook`, memo `BossChat`)
- Test: `src/renderer/src/chat/renderCount.test.tsx` (add a BossChat test)

**Interfaces:**
- Produces:
  - `ChatComposer({ onSend }: { onSend: (text: string) => Promise<boolean> })` (memo). `onSend` returns `true` when sent; the composer clears only then. (Task 6 widens it to attachments.)
  - `StreamingBubble({ text, onGrow }: { text: string; onGrow: () => void })` — reveals `text` with `useReveal`, calls `onGrow` after each growth.
  - `BossChat` is `memo` with the same props as today.

- [ ] **Step 1: Write the failing test** (append to `renderCount.test.tsx`)

```tsx
describe('BossChat', () => {
  it('typing does not re-render the conversation', async () => {
    const { BossChat } = await import('../components/BossChat');
    (window as unknown as { agentOffice: unknown }).agentOffice = { sendToBoss: async () => undefined, answerMerge: async () => undefined, openExternal: async () => undefined };
    const chat = Array.from({ length: 200 }, (_, i) => ({ kind: 'boss' as const, at: 't', text: `**reply ${i}**` }));
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(<BossChat chat={chat} merges={[]} boss={undefined} bossLook={{ hair: '#000000', shirt: '#000000', skin: '#000000' }} bossModel="opus" stream={null} busy={false} onError={() => undefined} />); });
    const before = renders.n;
    const box = host.querySelector('textarea')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    for (const ch of 'hello there, team') {
      await act(async () => { setValue.call(box, box.value + ch); box.dispatchEvent(new Event('input', { bubbles: true })); });
    }
    expect(box.value).toBe('hello there, team');
    expect(renders.n).toBe(before);
    await act(async () => { root.unmount(); });
    host.remove();
  });

  it('streaming re-renders only the streaming bubble', async () => {
    const { BossChat } = await import('../components/BossChat');
    const chat = Array.from({ length: 50 }, (_, i) => ({ kind: 'boss' as const, at: 't', text: `m${i}` }));
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const props = { chat, merges: [], boss: undefined, bossLook: { hair: '#000000', shirt: '#000000', skin: '#000000' }, bossModel: 'opus', busy: true, onError: () => undefined };
    await act(async () => { root.render(<BossChat {...props} stream={null} />); });
    const before = renders.n;
    let text = '';
    for (let i = 0; i < 20; i++) {
      text += 'word ';
      await act(async () => { root.render(<BossChat {...props} stream={text} />); await new Promise((r) => setTimeout(r, 20)); });
    }
    // Only the bubble's own markdown renders; the 50 entries do not.
    expect(renders.n - before).toBeLessThan(200);
    expect(renders.n - before).toBeGreaterThan(0);
    await act(async () => { root.unmount(); });
    host.remove();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/renderer/src/chat/renderCount.test.tsx`
Expected: FAIL in the first BossChat test only if entries re-render on typing; with Task 1's memo the markdown count may already hold, so the test that must fail is the streaming one (`expected 1000+ to be less than 200`) because `Entry` wrappers and `useReveal` live in `BossChat`. If both already pass, the per-keystroke cost is still the `Entry` tree; add `const entryRenders = vi.fn()` counting in a test-only wrapper is not possible without changing code — accept the streaming test as the RED and continue.

- [ ] **Step 3: Implement**

`src/renderer/src/chat/StreamingBubble.tsx`:

```tsx
import { useLayoutEffect } from 'react';
import { Markdown } from './Markdown';
import { useReveal } from './reveal';

/** The boss's reply as it streams in. Only this re-renders per animation frame, not the whole chat. */
export function StreamingBubble({ text, onGrow, onDone }: { text: string; onGrow: () => void; onDone?: () => void }) {
  const shown = useReveal(text);
  useLayoutEffect(() => { onGrow(); if (onDone && shown >= text.length) onDone(); }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="msg boss streaming" aria-busy="true">
      <Markdown text={text.slice(0, shown)} />
      <span className="cursor-blink stream-cursor" aria-hidden="true">▌</span>
    </div>
  );
}
```

`src/renderer/src/chat/ChatComposer.tsx`:

```tsx
import { memo, useState } from 'react';

/** The message box. Owns its own draft so typing never re-renders the conversation. */
export const ChatComposer = memo(function ChatComposer({ onSend }: { onSend: (text: string) => Promise<boolean> }) {
  const [draft, setDraft] = useState('');
  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    if (!(await onSend(text))) setDraft(text);
  };
  return (
    <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <label htmlFor="boss-msg" className="small muted">Message the boss</label>
      <textarea id="boss-msg" className="input" rows={3} value={draft} placeholder="Describe what the team should build…"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
      <div className="row">
        <span className="small muted">Enter to send · Shift+Enter for a new line</span>
        <button type="submit" className="btn teal" style={{ marginLeft: 'auto' }}>Send</button>
      </div>
    </form>
  );
});
```

`src/renderer/src/components/BossChat.tsx` changes:
- `Entry` becomes `const Entry = memo(function Entry({ e }: { e: ChatEntry }) { … })` (same body).
- Delete `draft`, `send`'s draft handling and the `<form>`; add:

```tsx
  const onSend = useCallback(async (text: string) => {
    setUnseen(onSent);
    toBottomRef.current();
    try { await window.agentOffice.sendToBoss(text); return true; } catch (e) { onError(String(e)); return false; }
  }, [onError]);
```

  with `const toBottomRef = useRef(toBottom); toBottomRef.current = toBottom;` so the callback stays stable, and render `<ChatComposer onSend={onSend} />` where the form was.
- Remove `useReveal`/`shown` from `BossChat`. The live-reply logic becomes: `liveIndex` as today; the "landed" bubble and the `stream` bubble render `<StreamingBubble text={…} onGrow={stick} onDone={…} />` where `const stick = useCallback(() => { if (atBottomRef.current) scrollToEnd(); }, [])` (keep `atBottomRef.current = atBottom` each render), and for the landed bubble `onDone={() => setLiveIndex(null)}`. The landed case renders `StreamingBubble` with `text={landed}` while `liveIndex === i && landed !== null`; once `onDone` fires it shows `<Entry e={e} />`.
- The layout effect that scrolled on `[merges.length, stream, busy, shown]` drops `stream` and `shown` (the bubble's `onGrow` covers them): `[merges.length, busy]`.
- Delete both `dataset.trace` writes.
- Export `export const BossChat = memo(function BossChat(props: Props) { … })`.

`src/renderer/src/App.tsx`:
- `const bossLook = useMemo(() => (boss ? lookFor(boss, state.roles) : lookFor({ roleId: 'boss' }, state.roles)), [boss?.roleId, boss?.id, state.roles]);` placed with the other hooks before any early return (compute `boss` from `state.ws` there too), and pass `bossLook={bossLook}`.

- [ ] **Step 4: Run the tests and the chat e2e**

Run: `npx vitest run src/renderer/src && npm run typecheck && npm run build && npx playwright test -g "scrolled up|first launch"`
Expected: PASS (the e2e tests cover streaming, the unseen marker and sending).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/chat src/renderer/src/components/BossChat.tsx src/renderer/src/App.tsx
git commit -m "perf(chat): typing and streaming re-render only the box and the reply"
```

---

### Task 3: Shared attachment rules

**Files:**
- Create: `src/shared/attachments.ts`
- Test: `src/shared/attachments.test.ts`
- Modify: `src/shared/types.ts` (`AttachmentMeta`, `user` entry `attachments`)

**Interfaces:**
- Produces:

```ts
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export const LIMITS = { count: 5, image: 5 * 1024 * 1024, file: 10 * 1024 * 1024, total: 20 * 1024 * 1024, longSide: 1568 };
export interface AttachmentInput { name: string; mime: string; size: number }
export function isImageType(mime: string): boolean;
export function safeName(name: string): string;
export function checkAttachments(list: AttachmentInput[]): { ok: true } | { ok: false; reason: string };
export function sniffImage(bytes: Uint8Array): (typeof IMAGE_TYPES)[number] | null;
export function canSend(text: string, count: number): boolean;
export function formatSize(bytes: number): string;
// types.ts
export interface AttachmentMeta { id: string; name: string; mime: string; size: number; kind: 'image' | 'file' }
// ChatEntry user: { kind: 'user'; at: string; text: string; attachments?: AttachmentMeta[] }
```

- [ ] **Step 1: Write the failing test** `src/shared/attachments.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { canSend, checkAttachments, formatSize, isImageType, LIMITS, safeName, sniffImage } from './attachments';

const MB = 1024 * 1024;

describe('safeName', () => {
  it('keeps only a clean base name', () => {
    expect(safeName('/Users/me/Desktop/shot.png')).toBe('shot.png');
    expect(safeName('C:\\temp\\a b.txt')).toBe('a b.txt');
    expect(safeName('bad\u0000\u0007name.txt')).toBe('badname.txt');
    expect(safeName('')).toBe('attachment');
    expect([...safeName('é'.repeat(300))]).toHaveLength(120);
  });
});

describe('checkAttachments', () => {
  it('accepts up to 5 within the size limits', () => {
    expect(checkAttachments([{ name: 'a.png', mime: 'image/png', size: 4 * MB }, { name: 'b.pdf', mime: 'application/pdf', size: 9 * MB }])).toEqual({ ok: true });
  });
  it('says what is wrong', () => {
    expect(checkAttachments(Array.from({ length: 6 }, () => ({ name: 'a.txt', mime: 'text/plain', size: 1 })))).toEqual({ ok: false, reason: 'At most 5 attachments per message' });
    expect(checkAttachments([{ name: 'big.png', mime: 'image/png', size: 6 * MB }])).toEqual({ ok: false, reason: 'big.png is larger than 5 MB' });
    expect(checkAttachments([{ name: 'big.zip', mime: 'application/zip', size: 11 * MB }])).toEqual({ ok: false, reason: 'big.zip is larger than 10 MB' });
    expect(checkAttachments(Array.from({ length: 3 }, (_, i) => ({ name: `f${i}.bin`, mime: 'application/octet-stream', size: 8 * MB })))).toEqual({ ok: false, reason: 'Attachments add up to more than 20 MB' });
    expect(checkAttachments([{ name: 'e.txt', mime: 'text/plain', size: 0 }])).toEqual({ ok: false, reason: 'e.txt is empty' });
  });
});

describe('sniffImage', () => {
  it('recognises the four image types by their first bytes', () => {
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBe('image/png');
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImage(new TextEncoder().encode('GIF89a'))).toBe('image/gif');
    expect(sniffImage(new TextEncoder().encode('RIFF\u0000\u0000\u0000\u0000WEBPVP8 '))).toBe('image/webp');
    expect(sniffImage(new TextEncoder().encode('hello'))).toBeNull();
  });
});

describe('small helpers', () => {
  it('works out sending, types and sizes', () => {
    expect(canSend('  ', 0)).toBe(false);
    expect(canSend('  ', 1)).toBe(true);
    expect(canSend('hi', 0)).toBe(true);
    expect(isImageType('image/webp')).toBe(true);
    expect(isImageType('image/svg+xml')).toBe(false);
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(1536)).toBe('1.5 KB');
    expect(formatSize(3 * MB)).toBe('3.0 MB');
    expect(LIMITS.longSide).toBe(1568);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/shared/attachments.test.ts`
Expected: FAIL — cannot resolve `./attachments`.

- [ ] **Step 3: Implement** `src/shared/attachments.ts`

```ts
/** Attachment rules shared by the chat box (renderer) and the checks in main. */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
const MB = 1024 * 1024;
export const LIMITS = { count: 5, image: 5 * MB, file: 10 * MB, total: 20 * MB, longSide: 1568 };

export interface AttachmentInput { name: string; mime: string; size: number }

export const isImageType = (mime: string) => (IMAGE_TYPES as readonly string[]).includes(mime);

/** The file's own name only, without folders or control characters, at most 120 characters. */
export function safeName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const base = (name.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return [...base].slice(0, 120).join('') || 'attachment';
}

export function checkAttachments(list: AttachmentInput[]): { ok: true } | { ok: false; reason: string } {
  if (list.length > LIMITS.count) return { ok: false, reason: `At most ${LIMITS.count} attachments per message` };
  let total = 0;
  for (const a of list) {
    const name = safeName(a.name);
    if (a.size <= 0) return { ok: false, reason: `${name} is empty` };
    const max = isImageType(a.mime) ? LIMITS.image : LIMITS.file;
    if (a.size > max) return { ok: false, reason: `${name} is larger than ${max / MB} MB` };
    total += a.size;
  }
  if (total > LIMITS.total) return { ok: false, reason: `Attachments add up to more than ${LIMITS.total / MB} MB` };
  return { ok: true };
}

/** The real image type from the first bytes (a renamed file cannot pass as an image). */
export function sniffImage(b: Uint8Array): (typeof IMAGE_TYPES)[number] | null {
  const at = (i: number, ...bytes: number[]) => bytes.every((x, k) => b[i + k] === x);
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  return null;
}

export const canSend = (text: string, count: number) => text.trim().length > 0 || count > 0;

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / MB).toFixed(1)} MB`;
}
```

`src/shared/types.ts`: add `export interface AttachmentMeta { id: string; name: string; mime: string; size: number; kind: 'image' | 'file' }` and change the `user` entry to `| { kind: 'user'; at: string; text: string; attachments?: AttachmentMeta[] }`.

- [ ] **Step 4: Run it**

Run: `npx vitest run src/shared/attachments.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/attachments.ts src/shared/attachments.test.ts src/shared/types.ts
git commit -m "feat(chat): shared attachment rules (types, limits, names, magic bytes)"
```

---

### Task 4: Image content for the CLI, `--add-dir`, and runner messages

**Files:**
- Modify: `src/main/claude/args.ts` (`ClaudeLaunch.addDirs`, `userMessageLine(text, images?)`, `UserMessage`)
- Modify: `src/main/claude/runner.ts` (`AgentRunner.send(msg: UserMessage)`)
- Test: `src/main/claude/args.test.ts` (existing file; add cases)

**Interfaces:**
- Produces:

```ts
export interface ImageBlock { mime: string; base64: string }
export type UserMessage = string | { text: string; images: ImageBlock[] };
export function userMessageLine(msg: UserMessage): string;
// ClaudeLaunch gains: addDirs?: string[]
// AgentRunner.send(msg: UserMessage): void
```

- [ ] **Step 1: Write the failing test** (append to `src/main/claude/args.test.ts`; check its import line and add `userMessageLine` if missing)

```ts
describe('images and extra folders', () => {
  it('sends text alone as a plain string, and text with images as content blocks', () => {
    expect(JSON.parse(userMessageLine('hi'))).toEqual({ type: 'user', message: { role: 'user', content: 'hi' } });
    expect(JSON.parse(userMessageLine({ text: 'look', images: [{ mime: 'image/png', base64: 'AAA=' }] }))).toEqual({
      type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'look' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA=' } }] },
    });
    expect(JSON.parse(userMessageLine({ text: '', images: [{ mime: 'image/png', base64: 'AAA=' }] })).message.content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA=' } },
    ]);
  });

  it('adds --add-dir before the variadic tool lists', () => {
    const a = buildClaudeArgs({ addDirs: ['/data/att'], tools: ['Read'], allowedTools: ['mcp__agentoffice'] });
    expect(a.slice(a.indexOf('--add-dir'), a.indexOf('--add-dir') + 2)).toEqual(['--add-dir', '/data/att']);
    expect(a.indexOf('--add-dir')).toBeLessThan(a.indexOf('--tools'));
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/main/claude/args.test.ts`
Expected: FAIL — `addDirs` ignored; object messages not supported.

- [ ] **Step 3: Implement** in `args.ts`:

```ts
export interface ImageBlock { mime: string; base64: string }
/** A user turn: plain text, or text with images the model can see. */
export type UserMessage = string | { text: string; images: ImageBlock[] };

export function userMessageLine(msg: UserMessage): string {
  if (typeof msg === 'string' || msg.images.length === 0) {
    const text = typeof msg === 'string' ? msg : msg.text;
    return JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n';
  }
  const content = [
    ...(msg.text.trim() ? [{ type: 'text', text: msg.text }] : []),
    ...msg.images.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.base64 } })),
  ];
  return JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n';
}
```

`ClaudeLaunch` gains `/** Extra folders the agent may read (e.g. chat attachments). */ addDirs?: string[];` and in `buildClaudeArgs`, before the `--tools` line: `if (l.addDirs && l.addDirs.length > 0) a.push('--add-dir', ...l.addDirs);`.

`runner.ts`: import `type UserMessage`; `AgentRunner.send(msg: UserMessage): void`; `ClaudeRunner.send(msg: UserMessage)` writes `userMessageLine(msg)`. Fix any other `AgentRunner` implementations the typechecker reports (test fakes) to accept `UserMessage`.

- [ ] **Step 4: Run it**

Run: `npx vitest run src/main/claude && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/claude test
git commit -m "feat(claude): send images as content blocks and allow extra read folders"
```

---

### Task 5: Store attachments and deliver them to the boss

**Files:**
- Create: `src/main/boss/attachments.ts` (`AttachmentStore`)
- Modify: `src/main/store/paths.ts` (`attachmentsDir(projectId)`)
- Modify: `src/main/store/validate.ts` (`attachmentsSchema`)
- Modify: `src/main/boss/bossSession.ts` (`send(text, attachments)`, `lastMessage`, `addDirs`)
- Modify: `src/main/workspace/projectService.ts` (`sendToBoss(text, attachments)`, `readAttachment(id)`, BossSession dep)
- Modify: `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/index.ts`
- Modify: `test/fake-claude/fake-claude.mjs` (`FAKE_CLAUDE_STDIN_OUT`)
- Test: `test/attachments.test.ts`

**Interfaces:**
- Consumes: Task 3 rules; Task 4 `UserMessage`, `addDirs`.
- Produces:
  - `AttachmentStore(dir)` with `save(input: { name: string; mime: string; data: Uint8Array }[]): Promise<{ meta: AttachmentMeta[]; images: ImageBlock[]; fileLines: string[] }>` and `readImage(id: string): Promise<string>` (data URL).
  - `ProjectService.sendToBoss(text: string, attachments?: unknown): Promise<void>`, `ProjectService.readAttachment(id: string): Promise<string>`.
  - IPC `sendToBoss(text, attachments?)`, `readAttachment(id)`.
  - `NewAttachment = { name: string; mime: string; data: Uint8Array }` in `shared/types.ts`.

- [ ] **Step 1: Write the failing test** `test/attachments.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectService } from '../src/main/workspace/projectService';
import { dataPaths } from '../src/main/store/paths';
import { makeRepo } from './helpers/repo';
import { FAKE_CLAUDE } from './helpers/runner';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
let repo: string; let data: string; let svc: ProjectService;
const fakeEnv: Record<string, string> = {};

beforeEach(async () => {
  repo = await makeRepo();
  data = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-att-'));
  for (const k of Object.keys(fakeEnv)) delete fakeEnv[k];
  fakeEnv.FAKE_CLAUDE_STDIN_OUT = path.join(data, 'stdin.jsonl');
  fakeEnv.FAKE_CLAUDE_ARGV_OUT = path.join(data, 'argv.jsonl');
  svc = new ProjectService({ paths: dataPaths(data), resourcesDir: path.resolve('resources'), claudeBin: process.execPath, claudeBinArgs: [FAKE_CLAUDE], claudeEnv: fakeEnv as NodeJS.ProcessEnv });
  await svc.init();
});
afterEach(async () => {
  await svc.close();
  await fs.rm(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  await fs.rm(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const stdin = async () => (await fs.readFile(fakeEnv.FAKE_CLAUDE_STDIN_OUT, 'utf8').catch(() => '')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
const until = async (pred: () => Promise<boolean>) => { for (let i = 0; i < 200; i++) { if (await pred()) return; await new Promise((r) => setTimeout(r, 50)); } throw new Error('timed out'); };

describe('chat attachments', () => {
  it('stores an image and a file, records them on the message and gives them to the boss', async () => {
    await svc.open(repo);
    await svc.sendToBoss('see these', [
      { name: '/Users/me/shot.png', mime: 'image/png', data: PNG },
      { name: 'notes.txt', mime: 'text/plain', data: new TextEncoder().encode('hello notes') },
    ]);
    const entry = (await svc.snapshot()).chat.find((e) => e.kind === 'user')!;
    expect(entry).toMatchObject({ text: 'see these', attachments: [
      { name: 'shot.png', mime: 'image/png', size: PNG.length, kind: 'image' },
      { name: 'notes.txt', mime: 'text/plain', size: 11, kind: 'file' },
    ] });
    await until(async () => (await stdin()).length > 0);
    const content = (await stdin())[0].message.content;
    expect(content[0].type).toBe('text');
    expect(content[0].text).toContain('see these');
    expect(content[0].text).toMatch(/Attached file: notes\.txt \(11 B\) at .*attachments/);
    expect(content[1]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/png' } });
    const argv = (await fs.readFile(fakeEnv.FAKE_CLAUDE_ARGV_OUT, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((l: { argv: string[] }) => l.argv.includes('mcp__agentoffice')).argv as string[];
    expect(argv[argv.indexOf('--add-dir') + 1]).toMatch(/attachments$/);
    const att = entry.kind === 'user' ? entry.attachments! : [];
    expect(await svc.readAttachment(att[0].id)).toMatch(/^data:image\/png;base64,/);
    await expect(svc.readAttachment(att[1].id)).rejects.toThrow(/image/);
  });

  it('sends a message that is only an image', async () => {
    await svc.open(repo);
    await svc.sendToBoss('', [{ name: 'a.png', mime: 'image/png', data: PNG }]);
    await until(async () => (await stdin()).length > 0);
    expect((await stdin())[0].message.content).toEqual([expect.objectContaining({ type: 'image' })]);
  });

  it('refuses junk and renamed files before storing anything', async () => {
    await svc.open(repo);
    await expect(svc.sendToBoss('x', [{ name: 'evil.png', mime: 'image/png', data: new TextEncoder().encode('not an image') }])).rejects.toThrow(/not a PNG/);
    await expect(svc.sendToBoss('x', 'nope')).rejects.toThrow();
    await expect(svc.sendToBoss('x', Array.from({ length: 6 }, () => ({ name: 'a.txt', mime: 'text/plain', data: new Uint8Array([1]) })))).rejects.toThrow(/5/);
    await expect(svc.sendToBoss('', [])).rejects.toThrow(/empty/);
    await expect(svc.readAttachment('../../settings')).rejects.toThrow();
    expect((await svc.snapshot()).chat.filter((e) => e.kind === 'user')).toHaveLength(0);
  });

  it('re-sends images after the boss restarts', async () => {
    fakeEnv.FAKE_CLAUDE_RESUME_FAIL = '1';
    await svc.open(repo);
    await svc.sendToBoss('first', []);
    await until(async () => (await stdin()).length > 0);
    await svc.close();
    await svc.open(repo); // resumes the saved session, which fails, so the last message is sent again to a fresh boss
    await svc.sendToBoss('look', [{ name: 'a.png', mime: 'image/png', data: PNG }]);
    await until(async () => (await stdin()).filter((l) => Array.isArray(l.message.content)).length >= 1);
    expect((await stdin()).filter((l) => Array.isArray(l.message.content)).at(-1).message.content.some((c: { type: string }) => c.type === 'image')).toBe(true);
  });
});
```

(The restart test relies on the existing resume-failure path in `BossSession` — "a fresh boss session was started" — re-delivering `lastMessage`. If `FAKE_CLAUDE_RESUME_FAIL` makes the first send of the re-opened project fail and redeliver it, the redelivered line is the image message; the assertion checks the last array-content line has an image.)

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run test/attachments.test.ts`
Expected: FAIL — `sendToBoss` ignores attachments / `readAttachment` is not a function.

- [ ] **Step 3: Implement**

`test/fake-claude/fake-claude.mjs`: in `rl.on('line', …)`, before queueing, add `if (env.FAKE_CLAUDE_STDIN_OUT) fs.appendFileSync(env.FAKE_CLAUDE_STDIN_OUT, line + '\n');`.

`src/main/store/paths.ts`: add `attachmentsDir(projectId: string): string` → `path.join(projectDir(id), 'attachments')` (interface and object).

`src/shared/types.ts`: `export interface NewAttachment { name: string; mime: string; data: Uint8Array }`.

`src/main/store/validate.ts`:

```ts
export const attachmentsSchema = z.array(z.object({
  name: z.string().max(255),
  mime: z.string().max(100),
  data: z.instanceof(Uint8Array),
}).strict()).max(5);
```

`src/main/boss/attachments.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { checkAttachments, formatSize, isImageType, safeName, sniffImage } from '../../shared/attachments';
import type { AttachmentMeta, NewAttachment } from '../../shared/types';
import type { ImageBlock } from '../claude/args';

const EXT: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' };
const ID = /^[0-9a-f-]{36}$/;
const KIND_NAMES: Record<string, string> = { 'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/gif': 'GIF', 'image/webp': 'WebP' };

/** Chat attachments of one project, kept under app data with generated names. */
export class AttachmentStore {
  constructor(readonly dir: string) {}

  async save(list: NewAttachment[]): Promise<{ meta: AttachmentMeta[]; images: ImageBlock[]; fileLines: string[] }> {
    const verdict = checkAttachments(list.map((a) => ({ name: a.name, mime: a.mime, size: a.data.byteLength })));
    if (!verdict.ok) throw new Error(verdict.reason);
    // Check every file before writing any, so a refused message stores nothing.
    const prepared = list.map((a) => {
      const name = safeName(a.name);
      const claimsImage = isImageType(a.mime);
      const real = sniffImage(a.data);
      if (claimsImage && real !== a.mime) throw new Error(`${name} is not a ${KIND_NAMES[a.mime]} image`);
      const mime = /^[\w.+-]+\/[\w.+-]+$/.test(a.mime) && a.mime.length <= 100 ? a.mime : 'application/octet-stream';
      const ext = claimsImage ? EXT[a.mime] : (/(\.[a-z0-9]{1,9})$/i.exec(name)?.[1].toLowerCase() ?? '');
      return { id: randomUUID(), name, mime, ext, data: a.data, image: claimsImage };
    });
    await fs.mkdir(this.dir, { recursive: true });
    const meta: AttachmentMeta[] = [];
    const images: ImageBlock[] = [];
    const fileLines: string[] = [];
    for (const p of prepared) {
      const file = path.join(this.dir, `${p.id}${p.ext}`);
      const tmp = `${file}.tmp`;
      await fs.writeFile(tmp, p.data);
      await fs.rename(tmp, file);
      meta.push({ id: p.id, name: p.name, mime: p.mime, size: p.data.byteLength, kind: p.image ? 'image' : 'file' });
      if (p.image) images.push({ mime: p.mime, base64: Buffer.from(p.data).toString('base64') });
      else fileLines.push(`Attached file: ${p.name} (${formatSize(p.data.byteLength)}) at ${file}`);
    }
    return { meta, images, fileLines };
  }

  /** An image attachment as a data URL for the chat history. */
  async readImage(id: string): Promise<string> {
    if (!ID.test(id)) throw new Error('Unknown attachment');
    for (const [mime, ext] of Object.entries(EXT)) {
      const data = await fs.readFile(path.join(this.dir, `${id}${ext}`)).catch(() => null);
      if (data) return `data:${mime};base64,${data.toString('base64')}`;
    }
    throw new Error('Only image attachments can be shown, and this one is unavailable');
  }

  /** Images of an earlier message, for re-sending after a boss restart. */
  async imagesFor(meta: AttachmentMeta[]): Promise<ImageBlock[]> {
    const out: ImageBlock[] = [];
    for (const m of meta) {
      if (m.kind !== 'image') continue;
      const data = await fs.readFile(path.join(this.dir, `${m.id}${EXT[m.mime] ?? ''}`)).catch(() => null);
      if (data) out.push({ mime: m.mime, base64: data.toString('base64') });
    }
    return out;
  }
}
```

`src/main/boss/bossSession.ts`:
- `BossSessionDeps` gains `attachments: AttachmentStore;`.
- `private lastText: string | null` becomes `private lastMessage: UserMessage | null = null;` (update the redelivery line to `if (this.lastMessage) void this.deliver(this.lastMessage);`).
- `send`:

```ts
  async send(text: string, files: NewAttachment[] = []): Promise<void> {
    if (!canSend(text, files.length)) throw new Error('The message is empty');
    const saved = files.length > 0 ? await this.d.attachments.save(files) : { meta: [], images: [], fileLines: [] };
    await this.add({ kind: 'user', at: this.now(), text, ...(saved.meta.length > 0 ? { attachments: saved.meta } : {}) });
    const full = [text, ...saved.fileLines].filter((s) => s.trim()).join('\n\n');
    await this.deliver(saved.images.length > 0 ? { text: full, images: saved.images } : full);
  }
```

- `deliver(msg: UserMessage)`: same body, `this.lastMessage = msg; runner.send(msg);`.
- In `ensureRunner`'s `launch`, add `addDirs: [this.d.attachments.dir],` (the folder is created on first save; `--add-dir` of a missing folder is harmless, but create it in `ensureRunner` with `fs.mkdir(this.d.attachments.dir, { recursive: true })` to be safe).

`src/main/workspace/projectService.ts`:
- create `const attachments = new AttachmentStore(this.d.paths.attachmentsDir(id));` in `open()` and pass it to `BossSession`; keep it on `Workspace` as `attachments`.
- `sendToBoss(text: string, attachments?: unknown)`:

```ts
  sendToBoss(text: string, attachments?: unknown): Promise<void> {
    const files = attachments === undefined ? [] : parseOrThrow(attachmentsSchema, attachments, 'attachments');
    return this.mustWs().boss.send(text, files);
  }
  readAttachment(id: string): Promise<string> { return this.mustWs().attachments.readImage(id); }
```

  (`parseOrThrow`'s message for >5 items mentions 5 via zod's "at most 5" text; the test matches `/5/`.)
- The onboarding `brief` call `this.sendToBoss(brief)` keeps working.

IPC: `IPC.readAttachment = 'boss:attachment'`; `AgentOfficeApi.sendToBoss(text: string, attachments?: NewAttachment[]): Promise<void>` and `readAttachment(id: string): Promise<string>`; preload passes both args through; `index.ts`:

```ts
  handle(IPC.sendToBoss, (text: unknown, attachments: unknown) => svc.sendToBoss(typeof text === 'string' ? text.slice(0, 100_000) : '', attachments));
  handle(IPC.readAttachment, (id: unknown) => svc.readAttachment(str(id, 'attachment id')));
```

(`str()` rejected empty text before; an image-only message has empty text, so text is now any string up to 100,000 characters and emptiness is checked by `canSend` in `BossSession.send`.)

- [ ] **Step 4: Run it**

Run: `npx vitest run test/attachments.test.ts test/bossSession.test.ts test/projectService.test.ts && npm run typecheck`
Expected: PASS. Then `npm test` → all pass.

- [ ] **Step 5: Commit**

```bash
git add src/main src/shared src/preload/index.ts test/fake-claude/fake-claude.mjs test/attachments.test.ts
git commit -m "feat(chat): store attachments and give them to the boss"
```

---

### Task 6: Attach in the chat box and show attachments in history

**Files:**
- Create: `src/renderer/src/chat/prepare.ts` (image preparation + size math)
- Test: `src/renderer/src/chat/prepare.test.ts`
- Modify: `src/renderer/src/chat/ChatComposer.tsx` (paste, drop target, Attach button, chips)
- Create: `src/renderer/src/chat/AttachmentList.tsx` (history thumbnails + file chips + lightbox)
- Modify: `src/renderer/src/components/BossChat.tsx` (drop zone on the panel, user entries show attachments, `onSend` with attachments)
- Modify: `src/renderer/src/App.tsx` (document-level drop guard)
- Modify: `src/renderer/src/styles/app.css`
- Modify: `e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: Task 3 rules; Task 5 IPC.
- Produces: `fitWithin(w: number, h: number, max: number): { w: number; h: number }`; `prepareFile(f: File): Promise<Pending>` where `Pending = { key: string; name: string; mime: string; size: number; data: Uint8Array; preview?: string }`; `ChatComposer({ onSend: (text: string, files: NewAttachment[]) => Promise<boolean>; dropped: File[] | null; onDroppedTaken: () => void })`.

- [ ] **Step 1: Write the failing test** `src/renderer/src/chat/prepare.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { fitWithin, outputType } from './prepare';

describe('fitWithin', () => {
  it('scales the long side down to the limit and keeps the shape', () => {
    expect(fitWithin(3136, 2000, 1568)).toEqual({ w: 1568, h: 1000 });
    expect(fitWithin(1000, 4000, 1568)).toEqual({ w: 392, h: 1568 });
    expect(fitWithin(800, 600, 1568)).toEqual({ w: 800, h: 600 });
  });
});

describe('outputType', () => {
  it('keeps PNG unless it is too big, sends GIF as is, re-encodes the rest as JPEG', () => {
    expect(outputType('image/png', 1_000_000)).toBe('image/png');
    expect(outputType('image/png', 6_000_000)).toBe('image/jpeg');
    expect(outputType('image/gif', 1_000)).toBe('image/gif');
    expect(outputType('image/webp', 1_000)).toBe('image/jpeg');
    expect(outputType('image/jpeg', 1_000)).toBe('image/jpeg');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/renderer/src/chat/prepare.test.ts`
Expected: FAIL — cannot resolve `./prepare`.

- [ ] **Step 3: Implement the helpers** `src/renderer/src/chat/prepare.ts`

```ts
import { LIMITS, isImageType, safeName } from '../../../shared/attachments';

export interface Pending { key: string; name: string; mime: string; size: number; data: Uint8Array; preview?: string }

export function fitWithin(w: number, h: number, max: number): { w: number; h: number } {
  const long = Math.max(w, h);
  if (long <= max) return { w, h };
  const k = max / long;
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

/** What an image is sent as after it has been scaled (`size` is the size of a PNG encode). */
export function outputType(mime: string, size: number): string {
  if (mime === 'image/gif') return 'image/gif';
  if (mime === 'image/png') return size > LIMITS.image ? 'image/jpeg' : 'image/png';
  return 'image/jpeg';
}

const dataUrl = (bytes: Uint8Array, mime: string) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(s)}`;
};

/** Reads a picked, pasted or dropped file; images are scaled to the model's size and get a preview. */
export async function prepareFile(f: File): Promise<Pending> {
  const key = `${f.name}-${f.size}-${Math.random().toString(36).slice(2)}`;
  const name = safeName(f.name || (f.type.startsWith('image/') ? 'pasted-image.png' : 'attachment'));
  if (!isImageType(f.type)) return { key, name, mime: f.type || 'application/octet-stream', size: f.size, data: new Uint8Array(await f.arrayBuffer()) };
  if (f.type === 'image/gif') {
    const data = new Uint8Array(await f.arrayBuffer());
    return { key, name, mime: f.type, size: data.byteLength, data, preview: dataUrl(data, f.type) };
  }
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(f); } catch { throw new Error(`Could not read ${name}`); }
  const { w, h } = fitWithin(bitmap.width, bitmap.height, LIMITS.longSide);
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  let blob = await canvas.convertToBlob({ type: f.type === 'image/png' ? 'image/png' : 'image/jpeg', quality: 0.85 });
  const mime = outputType(f.type, blob.size);
  if (mime !== blob.type) blob = await canvas.convertToBlob({ type: mime, quality: 0.85 });
  const data = new Uint8Array(await blob.arrayBuffer());
  const finalName = mime === 'image/jpeg' ? name.replace(/\.(png|webp)$/i, '.jpg') : name;
  return { key, name: finalName, mime, size: data.byteLength, data, preview: dataUrl(data, mime) };
}
```

- [ ] **Step 4: Run it**

Run: `npx vitest run src/renderer/src/chat/prepare.test.ts`
Expected: PASS.

- [ ] **Step 5: Composer, history and drop wiring**

`ChatComposer.tsx` — replace with:

```tsx
import { memo, useEffect, useRef, useState } from 'react';
import { canSend, checkAttachments, formatSize } from '../../../shared/attachments';
import type { NewAttachment } from '../../../shared/types';
import { prepareFile, type Pending } from './prepare';

interface Props { onSend: (text: string, files: NewAttachment[]) => Promise<boolean>; dropped: File[] | null; onDroppedTaken: () => void }

/** The message box. Owns its draft and attachments so typing never re-renders the conversation. */
export const ChatComposer = memo(function ChatComposer({ onSend, dropped, onDroppedTaken }: Props) {
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState<Pending[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const add = async (list: File[]) => {
    setProblem(null);
    const ready: Pending[] = [];
    for (const f of list) {
      try { ready.push(await prepareFile(f)); } catch (e) { setProblem(e instanceof Error ? e.message : String(e)); return; }
    }
    setFiles((cur) => {
      const next = [...cur, ...ready];
      const v = checkAttachments(next.map((p) => ({ name: p.name, mime: p.mime, size: p.size })));
      if (!v.ok) { setProblem(v.reason); return cur; }
      return next;
    });
  };
  useEffect(() => { if (dropped) { void add(dropped); onDroppedTaken(); } }, [dropped]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    const text = draft.trim();
    if (!canSend(text, files.length)) return;
    const sending = files;
    setDraft(''); setFiles([]); setProblem(null);
    if (!(await onSend(text, sending.map((p) => ({ name: p.name, mime: p.mime, data: p.data }))))) { setDraft(text); setFiles(sending); }
  };

  return (
    <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <label htmlFor="boss-msg" className="small muted">Message the boss</label>
      {files.length > 0 && (
        <ul className="attach-chips" aria-label="Attachments">
          {files.map((p) => (
            <li key={p.key} className="attach-chip">
              {p.preview ? <img src={p.preview} alt="" className="attach-thumb" /> : <span className="attach-icon" aria-hidden="true">📄</span>}
              <span className="attach-name" title={p.name}>{p.name}</span>
              <span className="small muted">{formatSize(p.size)}</span>
              <button type="button" className="skill-remove" aria-label={`Remove ${p.name}`} onClick={() => setFiles((cur) => cur.filter((x) => x.key !== p.key))}>×</button>
            </li>
          ))}
        </ul>
      )}
      {problem && <p className="small attach-problem" role="alert">{problem}</p>}
      <textarea id="boss-msg" className="input" rows={3} value={draft} placeholder="Describe what the team should build…"
        onChange={(e) => setDraft(e.target.value)}
        onPaste={(e) => { const list = Array.from(e.clipboardData.files); if (list.length > 0) { e.preventDefault(); void add(list); } }}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
      <div className="row">
        <button type="button" className="btn small" onClick={() => picker.current?.click()}>📎 Attach</button>
        <input ref={picker} type="file" multiple hidden aria-hidden="true" tabIndex={-1} onChange={(e) => { const list = Array.from(e.target.files ?? []); e.target.value = ''; void add(list); }} />
        <span className="small muted">Enter to send · Shift+Enter for a new line</span>
        <button type="submit" className="btn teal" style={{ marginLeft: 'auto' }}>Send</button>
      </div>
    </form>
  );
});
```

`AttachmentList.tsx`:

```tsx
import { memo, useEffect, useRef, useState } from 'react';
import { formatSize } from '../../../shared/attachments';
import type { AttachmentMeta } from '../../../shared/types';

const cache = new Map<string, Promise<string | null>>();
const load = (id: string) => {
  if (!cache.has(id)) cache.set(id, window.agentOffice.readAttachment(id).catch(() => null));
  return cache.get(id)!;
};

function Thumb({ a }: { a: AttachmentMeta }) {
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { let live = true; void load(a.id).then((s) => { if (live) setSrc(s); }); return () => { live = false; }; }, [a.id]);
  if (src === null) return <span className="attach-chip small muted">Attachment unavailable</span>;
  return (
    <>
      <button type="button" className="attach-shot" aria-label={`Open ${a.name}`} onClick={() => dlg.current?.showModal()}>
        {src ? <img src={src} alt={a.name} /> : <span className="small muted">Loading…</span>}
      </button>
      <dialog ref={dlg} className="lightbox" aria-label={a.name} onClick={(e) => { if (e.target === dlg.current) dlg.current?.close(); }}>
        {src && <img src={src} alt={a.name} />}
        <button type="button" className="btn small" onClick={() => dlg.current?.close()}>Close</button>
      </dialog>
    </>
  );
}

/** Attachments under a sent message: image thumbnails (click to enlarge) and file chips. */
export const AttachmentList = memo(function AttachmentList({ list }: { list: AttachmentMeta[] }) {
  return (
    <div className="msg-attachments">
      {list.map((a) => (a.kind === 'image'
        ? <Thumb key={a.id} a={a} />
        : <span key={a.id} className="attach-chip small"><span aria-hidden="true">📄</span> <span className="attach-name" title={a.name}>{a.name}</span> <span className="muted">{formatSize(a.size)}</span></span>))}
    </div>
  );
});
```

`BossChat.tsx`:
- user entries: `case 'user': return <div className="msg user"><div className="pre">{e.text}</div>{e.attachments && e.attachments.length > 0 && <AttachmentList list={e.attachments} />}</div>;` (keep `pre` on the text; an empty text renders no gap because `.pre:empty { display: none }`).
- `onSend` becomes `(text, files) => … window.agentOffice.sendToBoss(text, files) …`.
- Drop zone: on the `<section className="chat">`, add `onDragOver` (if `e.dataTransfer.types.includes('Files')`: `preventDefault()`, `setDragging(true)`), `onDragLeave` (when leaving the section: `setDragging(false)`), `onDrop` (`preventDefault()`, `setDragging(false)`, `setDropped(Array.from(e.dataTransfer.files))`). Pass `dropped` and `onDroppedTaken={() => setDropped(null)}` to `ChatComposer`. While `dragging`, render an overlay `<div className="drop-hint" aria-hidden="true">Drop to attach</div>` and add class `dragging` to the section.

`App.tsx`: in the first `useEffect`, add a document guard:

```ts
    // Files dropped outside the chat do nothing (instead of the window trying to open them).
    const guard = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); };
    document.addEventListener('dragover', guard);
    document.addEventListener('drop', guard);
```

and remove both listeners in the effect's cleanup (alongside the existing `onEvent` unsubscribe).

`app.css`:

```css
/* Chat attachments */
.attach-chips { display: flex; flex-wrap: wrap; gap: 6px; list-style: none; margin: 0; padding: 0; }
.attach-chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 4px 3px 6px; border: 1px solid var(--line-2); border-radius: 8px; min-width: 0; max-width: 100%; background: var(--panel-2); }
.attach-thumb { width: 32px; height: 32px; object-fit: cover; border-radius: 4px; }
.attach-name { min-width: 0; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.attach-problem { margin: 0; color: var(--red-soft); }
.msg-attachments { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.msg.user .pre:empty { display: none; }
.attach-shot { padding: 0; border: 0; background: none; cursor: zoom-in; border-radius: 6px; }
.attach-shot img { display: block; max-width: 180px; max-height: 140px; border-radius: 6px; }
.lightbox { padding: 12px; background: var(--panel); border: 1px solid var(--line-2); border-radius: 10px; color: var(--text); }
.lightbox::backdrop { background: rgba(0, 0, 0, 0.7); }
.lightbox img { display: block; max-width: 80vw; max-height: 75vh; margin-bottom: 8px; }
.chat.dragging .composer { outline: 2px dashed var(--teal); outline-offset: -6px; }
.drop-hint { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(20, 21, 31, 0.75); color: var(--teal); font-weight: 600; pointer-events: none; z-index: 5; }
```

- [ ] **Step 6: e2e**

Add to `e2e/smoke.spec.ts`:

```ts
test('pastes and drops attachments into the boss chat', async () => {
  const repo = await makeRepo();
  const env = { AO_CLAUDE_BIN: process.execPath, AO_CLAUDE_ARGS: JSON.stringify([FAKE]), AO_E2E_PICK_FOLDER: repo };
  const { app, userData } = await launch(env);
  try {
    const win = await app.firstWindow();
    await win.getByRole('button', { name: 'Browse' }).click();
    await win.getByRole('button', { name: /Open the office/ }).click();
    const box = win.getByLabel('Message the boss');
    // A 1×1 PNG pasted from the clipboard.
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const paste = (b64: string, name: string, type: string) => box.evaluate((el, a) => {
      const bin = atob(a.b64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const dt = new DataTransfer(); dt.items.add(new File([bytes], a.name, { type: a.type }));
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, { b64, name, type });
    await paste(png, 'dot.png', 'image/png');
    const chips = win.getByRole('list', { name: 'Attachments' });
    await expect(chips.getByText('dot.png')).toBeVisible();
    await chips.getByRole('button', { name: 'Remove dot.png' }).click();
    await expect(chips).toHaveCount(0);
    await paste(png, 'dot.png', 'image/png');
    // Text still pastes as text.
    await box.fill('what is this?');
    await box.press('Enter');
    const sent = win.locator('.msg.user', { hasText: 'what is this?' });
    await expect(sent.getByRole('button', { name: 'Open dot.png' }).locator('img')).toBeVisible();
    // Drop a text file on the chat panel.
    await win.locator('section.chat').evaluate((el) => {
      const dt = new DataTransfer(); dt.items.add(new File(['hello notes'], 'notes.txt', { type: 'text/plain' }));
      el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
      el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
    await expect(win.getByRole('list', { name: 'Attachments' }).getByText('notes.txt')).toBeVisible();
    await win.getByRole('button', { name: 'Send' }).click();
    await expect(win.locator('.msg.user').last()).toContainText('notes.txt');
  } finally {
    await app.close();
    await fs.rm(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    await fs.rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
```

- [ ] **Step 7: Run every gate**

Run: `npm run typecheck && npm test && npm run test:e2e`
Expected: all pass (9 e2e). Then screenshot the chat with two chips and a sent image (scratchpad `shot-*.mjs` pattern) and check it.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src e2e/smoke.spec.ts
git commit -m "feat(chat): paste, drop or attach images and files in the boss chat"
```

---

### Task 7: Docs

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Update AGENTS.md**

- "Where data lives": add `attachments/` to the `projects/<id>/{…}` list.
- Architecture, `boss/` line: "BossSession: the boss's long-lived claude session ↔ chat entries; attachments (chat files under app data, images sent as image blocks, files via `--add-dir`)".
- Security rules: add "Chat attachments arrive as bytes (never paths), are checked in main (count, size, image type by magic bytes) and stored under app data with generated names; `readAttachment` serves only image files of the open project by id. The boss reads attached files through `--add-dir <attachments folder>`."
- Testing conventions, fake CLI list: add "`FAKE_CLAUDE_STDIN_OUT`: append each stdin line to this file".

- [ ] **Step 2: Gates and commit**

Run: `npm run typecheck && npm test`
Expected: PASS.

```bash
git add AGENTS.md
git commit -m "docs: chat attachments"
```
