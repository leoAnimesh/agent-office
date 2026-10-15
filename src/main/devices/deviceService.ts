import type { PreviewFrame, PreviewInput } from '../../shared/types';
import { AndroidDriver, IosDriver, type DeviceDriver, type DeviceKind } from './drivers';
import { pngSize, type Outline } from './parse';
import { electronShrink, type Shrink } from './shrink';
import type { DeviceTools } from './tools';

export interface DeviceState { kind: DeviceKind; running: boolean; name: string | null; holder: string | null; startedByApp: boolean; canInput: boolean }
interface Slot { driver: DeviceDriver; name: string | null; started: boolean; startedByApp: boolean; holder: string | null; outline: Outline | null; userAt: number; userNote: boolean; starting: Promise<void> | null }

const LABEL: Record<DeviceKind, string> = { android: 'Android emulator', ios: 'iOS Simulator' };
const USER_QUIET_MS = 30_000;
const KEY: Record<string, 'enter' | 'delete' | 'tab' | 'home' | 'back' | undefined> = { Enter: 'enter', Backspace: 'delete', Delete: 'delete', Escape: 'back', Home: 'home' };

/** The project's emulator and simulator: who is using each, the live view, and shutting down what the app started. */
export class DeviceService {
  private slots: Record<DeviceKind, Slot>;
  private watched: DeviceKind | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  /** Bumped by every watch(): a tick from an older watch never reschedules (no second polling loop). */
  private gen = 0;

  constructor(private readonly o: {
    tools: DeviceTools; prefer?(kind: DeviceKind): string | undefined; nameOf(agentId: string): string; taskOf(agentId: string): string | undefined;
    onChange?(): void; onFrame?(f: PreviewFrame): void; bootMs?: number; frameMs?: number; drivers?: Partial<Record<DeviceKind, DeviceDriver>>;
    /** Scales live-view frames down (default: Electron's nativeImage). */
    shrink?: Shrink;
  }) {
    const slot = (driver: DeviceDriver): Slot => ({ driver, name: null, started: false, startedByApp: false, holder: null, outline: null, userAt: 0, userNote: false, starting: null });
    this.slots = {
      android: slot(o.drivers?.android ?? new AndroidDriver(o.tools, { bootMs: o.bootMs })),
      ios: slot(o.drivers?.ios ?? new IosDriver(o.tools, { bootMs: o.bootMs })),
    };
  }

  private async ensure(kind: DeviceKind): Promise<Slot> {
    const s = this.slots[kind];
    if (s.started && await s.driver.running().catch(() => false)) return s;
    if (!s.starting) {
      s.starting = (async () => {
        const info = await s.driver.start(this.o.prefer?.(kind));
        Object.assign(s, { name: info.name, started: true, startedByApp: info.startedByApp, outline: null });
        this.o.onChange?.();
      })().finally(() => { s.starting = null; });
    }
    await s.starting;
    return s;
  }

  async use(agentId: string, kind: DeviceKind): Promise<DeviceDriver> {
    const s = this.slots[kind];
    if (s.holder && s.holder !== agentId) {
      const task = this.o.taskOf(s.holder);
      throw new Error(`The ${LABEL[kind]} is in use by ${this.o.nameOf(s.holder)}${task ? ` (${task})` : ''}. Try again when that task is finished, or ask the boss to sequence the work.`);
    }
    s.holder = agentId;
    try { await this.ensure(kind); } catch (e) { s.holder = null; throw e; }
    this.o.onChange?.();
    return s.driver;
  }

  setOutline(kind: DeviceKind, o: Outline) { this.slots[kind].outline = o; }
  refFor(kind: DeviceKind, ref: string): { x: number; y: number } {
    const p = this.slots[kind].outline?.refs.get(ref);
    if (!p) throw new Error('That ref is not on the screen any more. Take a new device_snapshot and use a ref from it.');
    return p;
  }

  release(agentId: string) {
    let changed = false;
    for (const s of Object.values(this.slots)) if (s.holder === agentId) { s.holder = null; changed = true; }
    if (changed) this.o.onChange?.();
  }

  async states(): Promise<DeviceState[]> {
    return Promise.all((Object.keys(this.slots) as DeviceKind[]).map(async (kind) => {
      const s = this.slots[kind];
      const running = s.started && await s.driver.running().catch(() => false);
      return { kind, running, name: s.name, holder: s.holder, startedByApp: s.startedByApp, canInput: s.driver.canInput };
    }));
  }

  async startByUser(kind: DeviceKind) { await this.ensure(kind); }
  async shutdownByUser(kind: DeviceKind) {
    const s = this.slots[kind];
    await s.starting?.catch(() => undefined);
    if (!s.startedByApp) throw new Error('This device was started outside AgentOffice; close it there.');
    if (this.watched === kind) this.watch(null);
    await s.driver.stop();
    Object.assign(s, { started: false, startedByApp: false, holder: null, outline: null });
    this.o.onChange?.();
  }

  takeUserNote(agentId: string, kind: DeviceKind): string | undefined {
    const s = this.slots[kind];
    if (s.holder !== agentId || !s.userNote) return undefined;
    s.userNote = false;
    return 'The user used this device since your last action; check its screen before continuing.';
  }

  /** Stream screenshots of one device to the Preview tab (null stops). */
  watch(kind: DeviceKind | null) {
    this.watched = kind;
    this.gen++;
    this.inFlight = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (kind) this.tick();
  }

  ack() { this.inFlight = false; }

  private tick() {
    const kind = this.watched;
    const gen = this.gen;
    if (!kind) return;
    this.timer = setTimeout(async () => {
      const s = this.slots[kind];
      if (this.watched === kind && !this.inFlight && s.started) {
        const png = await s.driver.screenshot().catch(() => null);
        // Phone screens are large PNGs: send the live view a small JPEG.
        const small = png ? await (this.o.shrink ?? electronShrink)(png, 900, 70).catch(() => null) : null;
        const size = small ? { w: small.w, h: small.h } : png ? pngSize(png) : null;
        if (png && size && this.watched === kind && gen === this.gen) {
          this.inFlight = true;
          this.o.onFrame?.({ agentId: `device:${kind}`, data: (small?.data ?? png).toString('base64'), width: size.w, height: size.h, mime: small?.mime ?? 'image/png' });
        }
      }
      if (gen === this.gen) this.tick();
    }, this.o.frameMs ?? 330);
  }

  async input(kind: DeviceKind, e: PreviewInput) {
    const s = this.slots[kind];
    if (!s.started) throw new Error(`The ${LABEL[kind]} is not running`);
    const now = Date.now();
    if (now - s.userAt > USER_QUIET_MS) s.userNote = true;
    s.userAt = now;
    if (e.kind === 'click') { const { w, h } = await s.driver.screenSize(); await s.driver.tap(e.x * w, e.y * h); }
    else if (e.kind === 'wheel') await s.driver.swipe(e.dy > 0 ? 'up' : 'down');
    else if (e.kind === 'text') await s.driver.type(e.text);
    else { const k = KEY[e.key]; if (k) await s.driver.press(k); }
  }

  async close() {
    this.watch(null);
    for (const s of Object.values(this.slots)) {
      // A boot may still be running: let it settle, then stop. Drivers only stop devices they started.
      await s.starting?.catch(() => undefined);
      await s.driver.stop().catch(() => undefined);
      Object.assign(s, { started: false, startedByApp: false, holder: null });
    }
  }
}
