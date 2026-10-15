# Fast Chat Input and Attachments — Design Spec

Date: 2026-10-15
Status: Draft for review

## 1. Summary

Two changes to the boss chat box:

1. **Typing is fast again.** Today every keystroke re-renders the whole chat and re-parses the markdown of every message (up to 500), and the boss's streaming reply re-renders the whole chat about 60 times a second. The draft moves into its own component and the message list, each message and the markdown renderer are memoized, so a keystroke re-renders only the text box and streaming re-renders only the streaming bubble.
2. **Images and files can be attached.** Paste an image or file from the clipboard, drop images or files on the chat, or pick them with an Attach button. Attachments show as removable chips above the text box, are sent with the message, are shown in the chat history, and reach the boss: images as real image input it can see, other files as a path it can read.

## 2. Goals and non-goals

**Goals**
- No visible lag typing in a chat with hundreds of long markdown messages, also while the boss is streaming.
- Paste (Cmd/Ctrl+V), drag-and-drop, and a keyboard-reachable Attach button.
- The boss sees images and can open attached files with its Read tool.
- Attachments stay with the message in history across restarts.

**Non-goals**
- Attachments in messages to employees (only the boss chat).
- Editing or re-sending old messages.
- Video, audio or folders.
- Virtualizing the message list (memoization is enough for the 500-message cap).

## 3. Performance

**Cause (measured by reading the render path):**
- `draft` state lives in `BossChat`, so each keystroke re-renders every `Entry`, and every `boss`/`report`/`event` entry and merge summary runs `ReactMarkdown` + `remark-gfm` again (`chat/Markdown.tsx` is not memoized and builds new `remarkPlugins`/`components` objects per render).
- `useReveal` calls `setShown` every animation frame while the boss streams; that state lives in `BossChat`, so the whole list and the composer re-render per frame, and a layout effect scrolls per frame.
- `App` re-renders on every agent event and passes a fresh `bossLook` object to `BossChat`.
- `onScroll` and a layout effect append to a debug `dataset.trace` string on the message list.

**Changes:**
- `chat/Markdown.tsx`: `remarkPlugins` and `components` become module constants; the component is `React.memo` (props: `text`).
- `BossChat.tsx` is split:
  - `ChatComposer` (new, `chat/ChatComposer.tsx`): owns `draft` and attachments; calls `onSend(text, attachments)`; memoized.
  - `MessageList` (memo): renders `chat` entries, the unseen marker and merge cards; props are `chat`, `merges`, `markerIndex`, `liveIndex`.
  - `Entry` becomes `React.memo` (entries are append-only and keep identity in the reducer).
  - `StreamingBubble` (new, small): owns `useReveal`; only it re-renders per frame. It reports "grew" to the parent through a ref callback that keeps the list scrolled to the bottom (no parent state change per frame).
- `App.tsx`: `bossLook` via `useMemo`; `BossChat` wrapped in `React.memo` with stable callbacks.
- Remove the `dataset.trace` debug writes.
- Test: a render-count test (Vitest with a `jsdom` environment for that file only, `react-dom/client` + `act`; adds `jsdom` as an exactly pinned dev dependency, no testing library) types 30 characters into a chat with 200 markdown messages and asserts `ReactMarkdown` rendered 0 extra times; a second test streams 50 frames and asserts existing entries did not re-render.

## 4. Attachments

### 4.1 Rules (`src/shared/attachments.ts`, pure, used by both sides)

- Images: `image/png`, `image/jpeg`, `image/gif`, `image/webp`.
- At most **5 attachments per message**; each image ≤ **5 MB** after preparation; each other file ≤ **10 MB**; total ≤ **20 MB**.
- Names: the base name only (no path parts), control characters removed, at most 120 characters (code points); empty → `attachment`.
- `checkAttachments(list): { ok: true } | { ok: false; reason: string }` with reasons the user can act on ("At most 5 attachments per message", "photo.png is larger than 5 MB", …).
- A message may be empty text if it has at least one attachment.

### 4.2 Composer (`ChatComposer`)

- **Paste:** `onPaste` reads `clipboardData.files`; if there are files, they are added and the default paste is prevented; plain text pastes stay normal.
- **Drop:** the whole chat panel accepts drops while a drag carrying `Files` is over it, with a dashed highlight and "Drop to attach"; text drags are left alone.
- **Attach button:** a `<button>` "Attach" (paperclip icon + text) opens a hidden `<input type="file" multiple>`.
- **Images are prepared in the renderer:** decoded with `createImageBitmap`; if the long side is over 1568 px it is scaled down (the boss would downscale anyway) and re-encoded (PNG stays PNG unless it is then over 5 MB, in which case JPEG q85; JPEG/WebP re-encode as JPEG q85); GIFs are sent as-is if ≤ 5 MB.
- **Chips** above the text box: image thumbnail (data URL; the CSP allows `img-src data:`) or a file icon, the clipped name, the size, and a `<button aria-label="Remove <name>">×</button>`. Problems (too big, too many) appear as a short message under the chips and the file is not added.
- **Send:** Enter or the Send button sends text + attachments; the chips clear after a successful send; on failure they stay with the text.

### 4.3 IPC

- `sendToBoss(text: string, attachments?: { name: string; mime: string; data: Uint8Array }[])`.
- Main validates with zod (`store/validate.ts`): array ≤ 5; `name` string ≤ 255; `mime` string ≤ 100; `data` a `Uint8Array` within the size limits; then re-runs `checkAttachments`. Images must match their type by magic bytes (PNG `89 50 4E 47`, JPEG `FF D8 FF`, GIF `GIF8`, WebP `RIFF....WEBP`); a mismatch is refused. Non-image files keep a generic `application/octet-stream` label if their type is not a short `type/subtype`.
- `readAttachment(id: string): Promise<string>` returns a `data:` URL for an image attachment of the open project (ids match `^[0-9a-f-]{36}$`; the file must be inside that project's attachments folder; ≤ 5 MB). Non-images are not readable over IPC.

### 4.4 Storage

- `projects/<id>/attachments/<uuid><ext>` where `ext` comes from the MIME type for images and from the sanitized name for files (`.txt`, `.pdf`, …; at most 10 characters of `[a-z0-9.]`, else none). Written atomically.
- The `user` `ChatEntry` gains `attachments?: { id: string; name: string; mime: string; size: number; kind: 'image' | 'file' }[]`.
- Attachments are never deleted automatically (they are small and belong to the history); closing or deleting a project does not change that today, so neither does this.

### 4.5 To the boss

- `userMessageLine(text, images)` (in `claude/args.ts`) builds `{ type: 'user', message: { role: 'user', content: [ { type: 'text', text }, ...images.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.base64 } })) ] } }`; with no images it keeps today's string content.
- Files: the text sent to the boss gains one line per file: `Attached file: <name> (<size>) at <absolute path>`.
- The boss launches with `--add-dir <attachments folder>` so its Read tool can open those files (it only has Read/Grep/Glob).
- `AgentRunner.send` accepts `string | { text: string; images: { mime: string; base64: string }[] }`. `BossSession` keeps the last delivered message (with images) so the existing "re-send after a crashed boss restarts" path re-sends the images too.

### 4.6 History

- A user message with attachments shows thumbnails (loaded once per id with `readAttachment`, cached in a module-level `Map`) and file chips under its text. Clicking a thumbnail opens a simple in-app lightbox (`<dialog>`, Escape closes). Missing files show "Attachment unavailable".

### 4.7 Drop safety

- A document-level `dragover`/`drop` handler prevents the default only for drags carrying `Files`, so a file dropped anywhere else in the window does nothing (Electron would otherwise try to open it; `will-navigate` already blocks that, this keeps it quiet).

## 5. Security

- The renderer never sends a path; it sends bytes, which main checks (count, size, type by magic bytes) and stores under app data with a generated name.
- `readAttachment` takes only an id and reads only inside the open project's attachments folder; images only.
- Image data reaches the boss only as image blocks; file contents reach it only through Read on the attachments folder, added with `--add-dir`.
- Thumbnails are `data:` URLs (allowed by the existing CSP); no CSP change.

## 6. Error handling

| Case | Behaviour |
| --- | --- |
| Too many / too big / unsupported image | Message under the chips; not added. |
| Image fails to decode in the renderer | "Could not read <name>"; not added. |
| Main refuses an attachment (size/type mismatch) | Error banner; the draft and chips stay. |
| Boss not running when sent | Same as today (the message is delivered when it starts), images included. |
| Attachment file missing later | Thumbnail/chip shows "Attachment unavailable". |

## 7. Testing

- Pure: `checkAttachments` (counts, sizes, names, empty text), name sanitizing, magic-byte check, `userMessageLine` with and without images, `buildClaudeArgs` with `addDirs`.
- Main: `ProjectService`/`BossSession` with the fake CLI: an image attachment is stored, the chat entry has metadata, the fake receives an `image` content block (new `FAKE_CLAUDE_STDIN_OUT` env records each stdin line), a file attachment's path appears in the text, `--add-dir` is in the boss launch; IPC validation refuses junk.
- Renderer: the render-count tests (§3); composer helpers (accept/reject reasons, image preparation sizes with a stubbed `createImageBitmap`).
- e2e: dispatch a `paste` with a PNG `File` into the chat box → a chip appears → remove it → paste again → send → the user message shows a thumbnail; drop a text file → a file chip → send → the message shows the file chip.
- Gates: `npm run typecheck && npm test && npm run test:e2e`.
