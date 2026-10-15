import { z } from 'zod';
import type { ToolDef, ToolImage } from '../agents/bossTools';
import { employeeTool as def } from '../browser/employeeTools';
import { LOCAL_ONLY, allowedUrl } from '../browser/rules';
import type { DeviceService } from './deviceService';
import { insideWorktree } from './parse';

const PLATFORM = z.enum(['android', 'ios']);
const KEYS = z.enum(['back', 'home', 'enter', 'delete', 'tab']);

export function deviceTools(d: { devices: DeviceService; worktreeOf(agentId: string): string | undefined }): ToolDef[] {
  const { devices } = d;
  const note = <T extends object>(agentId: string, platform: 'android' | 'ios', v: T): T & { note?: string } => {
    const n = devices.takeUserNote(agentId, platform);
    return n ? { ...v, note: n } : v;
  };
  return [
    def('device_start', 'Start (or attach to) the Android emulator or iOS Simulator and take it for your task. Only one employee can use each at a time.', { platform: PLATFORM },
      async ({ platform }, agentId) => { await devices.use(agentId, platform); const s = (await devices.states()).find((x) => x.kind === platform)!; return { name: s.name, booted: true, can_tap: s.canInput }; }),
    def('device_install', 'Install an app you built: an .apk (Android) or .app folder (iOS) inside your folder.', { platform: PLATFORM, path: z.string().min(1).max(500) },
      async ({ platform, path: p }, agentId) => {
        const root = d.worktreeOf(agentId);
        if (!root) throw new Error('You have no working folder yet; start a task first.');
        const file = await insideWorktree(root, p);
        await (await devices.use(agentId, platform)).install(file);
        return { installed: p };
      }),
    def('device_launch', 'Launch an installed app by its id (Android package name or iOS bundle id).', { platform: PLATFORM, app_id: z.string().regex(/^[A-Za-z0-9_.-]{1,200}$/) },
      async ({ platform, app_id }, agentId) => { await (await devices.use(agentId, platform)).launch(app_id); return note(agentId, platform, { launched: app_id }); }),
    def('device_open_url', 'Open a local URL (localhost / 127.0.0.1) in the device\'s browser; on Android it reaches your dev server through the emulator.', { platform: PLATFORM, url: z.string().min(1).max(2000) },
      async ({ platform, url }, agentId) => { if (!allowedUrl(url)) throw new Error(LOCAL_ONLY); await (await devices.use(agentId, platform)).openUrl(url); return note(agentId, platform, { opened: url }); }),
    def('device_snapshot', 'Read the screen as a list of elements with [ref=…] ids for device_tap. Refs change after every snapshot.', { platform: PLATFORM },
      async ({ platform }, agentId) => {
        const o = await (await devices.use(agentId, platform)).snapshot();
        devices.setOutline(platform, o);
        const n = devices.takeUserNote(agentId, platform);
        const text = o.text.length > 40 * 1024 ? `${o.text.slice(0, 40 * 1024)}\n… (cut at 40 KB)` : o.text;
        return `${n ? `${n}\n` : ''}${text}`;
      }),
    def('device_tap', 'Tap an element by its ref from the latest device_snapshot, or at x,y in device units.', { platform: PLATFORM, ref: z.string().max(20).optional(), x: z.number().min(0).max(10000).optional(), y: z.number().min(0).max(10000).optional() },
      async ({ platform, ref, x, y }, agentId) => {
        const dev = await devices.use(agentId, platform);
        const p = ref ? devices.refFor(platform, ref) : x !== undefined && y !== undefined ? { x, y } : null;
        if (!p) throw new Error('Give a ref from device_snapshot, or both x and y');
        await dev.tap(p.x, p.y);
        return note(agentId, platform, { ok: true });
      }),
    def('device_type', 'Type text into the focused field (tap the field first).', { platform: PLATFORM, text: z.string().min(1).max(2000) },
      async ({ platform, text }, agentId) => { await (await devices.use(agentId, platform)).type(text); return note(agentId, platform, { ok: true }); }),
    def('device_swipe', 'Swipe across the middle of the screen (up scrolls down the page).', { platform: PLATFORM, direction: z.enum(['up', 'down', 'left', 'right']) },
      async ({ platform, direction }, agentId) => { await (await devices.use(agentId, platform)).swipe(direction); return note(agentId, platform, { ok: true }); }),
    def('device_press', 'Press a device key: back (Android only), home, enter, delete or tab.', { platform: PLATFORM, key: KEYS },
      async ({ platform, key }, agentId) => { await (await devices.use(agentId, platform)).press(key); return note(agentId, platform, { ok: true }); }),
    def('device_screenshot', 'Take a screenshot of the device screen.', { platform: PLATFORM },
      async ({ platform }, agentId) => {
        const png = await (await devices.use(agentId, platform)).screenshot();
        const image: ToolImage = { type: 'image', data: png.toString('base64'), mimeType: 'image/png', note: devices.takeUserNote(agentId, platform) };
        return image;
      }),
    def('device_logs', 'Recent warnings and errors from the device log.', { platform: PLATFORM },
      async ({ platform }, agentId) => (await devices.use(agentId, platform)).logs()),
    def('device_release', 'Let other employees use the device now (it is also released when your task ends).', { platform: PLATFORM },
      async (_a, agentId) => { devices.release(agentId); return { released: true }; }),
  ];
}
