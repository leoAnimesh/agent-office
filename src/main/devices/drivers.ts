import { ANDROID_KEYS, adbText, androidOutline, androidUrl, iosOutline, parseAdbDevices, parseAvds, parseSimulators, pngSize, type DeviceKey, type Outline } from './parse';
import { runTool, startTool, type DeviceTools, type ToolCmd } from './tools';

export type DeviceKind = 'android' | 'ios';
export interface DeviceInfo { kind: DeviceKind; id: string; name: string; startedByApp: boolean }
export const IDB_HINT = 'Tapping and typing on iOS need idb: brew install facebook/fb/idb-companion and pip3 install fb-idb';

export interface DeviceDriver {
  readonly kind: DeviceKind;
  readonly canInput: boolean;
  start(prefer?: string): Promise<DeviceInfo>;
  running(): Promise<boolean>;
  stop(): Promise<void>;
  snapshot(): Promise<Outline>;
  tap(x: number, y: number): Promise<void>;
  type(text: string): Promise<void>;
  swipe(dir: 'up' | 'down' | 'left' | 'right'): Promise<void>;
  press(key: DeviceKey): Promise<void>;
  install(file: string): Promise<void>;
  launch(appId: string): Promise<void>;
  openUrl(url: string): Promise<void>;
  screenshot(): Promise<Buffer>;
  logs(): Promise<string>;
  screenSize(): Promise<{ w: number; h: number }>;
}

const SHOT = { maxBytes: 10 * 1024 * 1024 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const need = <T>(v: T | undefined, what: string): T => { if (!v) throw new Error(what); return v; };
const ok = async (p: Promise<{ code: number | null; stdout: Buffer; stderr: string }>, what: string) => {
  const r = await p;
  if (r.code !== 0) throw new Error(`${what} failed: ${(r.stderr || r.stdout.toString()).trim().split('\n').slice(-3).join(' ')}`);
  return r;
};
const swipeLine = (w: number, h: number, dir: string) => {
  const [cx, cy, dx, dy] = [w / 2, h / 2, w * 0.3, h * 0.3];
  const m: Record<string, number[]> = { up: [cx, cy + dy, cx, cy - dy], down: [cx, cy - dy, cx, cy + dy], left: [cx + dx, cy, cx - dx, cy], right: [cx - dx, cy, cx + dx, cy] };
  return m[dir].map((n) => String(Math.round(n)));
};

export class AndroidDriver implements DeviceDriver {
  readonly kind = 'android' as const;
  readonly canInput = true;
  private serial: string | null = null;
  private proc: ReturnType<typeof startTool> | null = null;
  private size: { w: number; h: number } | null = null;
  constructor(private readonly t: DeviceTools, private readonly o: { bootMs?: number } = {}) {}

  private get adb(): ToolCmd { return need(this.t.adb, 'No Android SDK found. Install Android Studio, or set ANDROID_HOME to your SDK folder.'); }
  private s(): string[] { return ['-s', need(this.serial ?? undefined, 'Start the Android emulator first (device_start)')]; }
  private shell(...args: string[]) { return ok(runTool(this.adb, [...this.s(), 'shell', ...args]), args[0]); }

  async start(prefer?: string): Promise<DeviceInfo> {
    const running = parseAdbDevices((await runTool(this.adb, ['devices'])).stdout.toString());
    if (running.length > 0) {
      this.serial = running[0];
      return { kind: 'android', id: this.serial, name: this.serial, startedByApp: false };
    }
    const emulator = need(this.t.emulator, 'The Android emulator was not found in your SDK.');
    const avds = parseAvds((await runTool(emulator, ['-list-avds'])).stdout.toString());
    const avd = prefer && avds.includes(prefer) ? prefer : avds[0];
    if (!avd) throw new Error('No Android emulator found: create one in Android Studio (Device Manager).');
    const port = 5554 + 2 * Math.floor(Math.random() * 64);
    this.proc = startTool(emulator, ['-avd', avd, '-no-window', '-no-audio', '-no-boot-anim', '-no-snapshot-save', '-port', String(port)]);
    this.serial = `emulator-${port}`;
    const deadline = Date.now() + (this.o.bootMs ?? 180_000);
    while (Date.now() < deadline) {
      const listed = parseAdbDevices((await runTool(this.adb, ['devices'])).stdout.toString()).includes(this.serial);
      if (listed && (await runTool(this.adb, [...this.s(), 'shell', 'getprop', 'sys.boot_completed'])).stdout.toString().trim() === '1') {
        return { kind: 'android', id: this.serial, name: avd, startedByApp: true };
      }
      await sleep(1000);
    }
    const out = this.proc.output();
    await this.stop();
    throw new Error(`The emulator did not finish starting in time. Last output:\n${out}`);
  }

  async running(): Promise<boolean> {
    if (!this.serial || !this.t.adb) return false;
    return parseAdbDevices((await runTool(this.t.adb, ['devices'])).stdout.toString()).includes(this.serial);
  }

  async stop(): Promise<void> {
    const p = this.proc;
    this.proc = null;
    if (p) {
      await runTool(this.adb, [...this.s(), 'emu', 'kill']).catch(() => undefined);
      await p.kill();
    }
    this.serial = p ? null : this.serial;
  }

  async snapshot(): Promise<Outline> {
    for (let i = 0; i < 2; i++) {
      const r = await runTool(this.adb, [...this.s(), 'exec-out', 'uiautomator', 'dump', '/dev/tty']);
      const xml = r.stdout.toString();
      if (r.code === 0 && xml.includes('<hierarchy')) return androidOutline(xml);
      await sleep(500);
    }
    throw new Error('Could not read the screen (it may be changing or protected). Try device_screenshot.');
  }

  async tap(x: number, y: number) { await this.shell('input', 'tap', String(Math.round(x)), String(Math.round(y))); }
  async type(text: string) { await this.shell('input', 'text', adbText(text)); }
  async swipe(dir: 'up' | 'down' | 'left' | 'right') { const { w, h } = await this.screenSize(); await this.shell('input', 'swipe', ...swipeLine(w, h, dir), '250'); }
  async press(key: DeviceKey) { await this.shell('input', 'keyevent', ANDROID_KEYS[key]); }
  async install(file: string) { await ok(runTool(this.adb, [...this.s(), 'install', '-r', file], { timeoutMs: 180_000 }), 'Install'); }
  async launch(appId: string) { await this.shell('monkey', '-p', appId, '-c', 'android.intent.category.LAUNCHER', '1'); }
  async openUrl(url: string) { await this.shell('am', 'start', '-a', 'android.intent.action.VIEW', '-d', androidUrl(url)); }
  async screenshot(): Promise<Buffer> {
    const r = await ok(runTool(this.adb, [...this.s(), 'exec-out', 'screencap', '-p'], SHOT), 'Screenshot');
    this.size = pngSize(r.stdout) ?? this.size;
    return r.stdout;
  }
  async logs() { return (await runTool(this.adb, [...this.s(), 'logcat', '-d', '-t', '200', '*:W'])).stdout.toString() || 'No warnings or errors.'; }
  async screenSize() { if (!this.size) await this.screenshot(); return need(this.size ?? undefined, 'Could not read the screen size'); }
}

export class IosDriver implements DeviceDriver {
  readonly kind = 'ios' as const;
  private udid: string | null = null;
  private booted = false;
  private size: { w: number; h: number } | null = null;
  constructor(private readonly t: DeviceTools, private readonly o: { bootMs?: number } = {}) {}

  get canInput() { return Boolean(this.t.idb); }
  private get xcrun(): ToolCmd {
    if (this.t.platform !== 'darwin') throw new Error('The iOS Simulator needs macOS with Xcode.');
    return need(this.t.xcrun, 'Xcode was not found. Install it from the App Store, then open it once.');
  }
  private id() { return need(this.udid ?? undefined, 'Start the iOS Simulator first (device_start)'); }
  private idb(...args: string[]) { return ok(runTool(need(this.t.idb, IDB_HINT), [...args, '--udid', this.id()]), args[1] ?? args[0]); }
  private simctl(...args: string[]) { return ok(runTool(this.xcrun, ['simctl', ...args], { timeoutMs: 60_000 }), args[0]); }

  async start(prefer?: string): Promise<DeviceInfo> {
    const sims = parseSimulators((await this.simctl('list', 'devices', 'available', '-j')).stdout.toString());
    const booted = sims.find((s) => s.state === 'Booted');
    if (booted) { this.udid = booted.udid; return { kind: 'ios', id: booted.udid, name: booted.name, startedByApp: false }; }
    const sim = sims.find((s) => s.udid === prefer) ?? sims[0];
    if (!sim) throw new Error('No iPhone simulator found: add one in Xcode (Window → Devices and Simulators).');
    this.udid = sim.udid;
    await this.simctl('boot', sim.udid);
    this.booted = true;
    await ok(runTool(this.xcrun, ['simctl', 'bootstatus', sim.udid], { timeoutMs: this.o.bootMs ?? 180_000 }), 'Boot');
    return { kind: 'ios', id: sim.udid, name: sim.name, startedByApp: true };
  }

  async running(): Promise<boolean> {
    if (!this.udid) return false;
    return parseSimulators((await this.simctl('list', 'devices', 'available', '-j')).stdout.toString()).some((s) => s.udid === this.udid && s.state === 'Booted');
  }

  async stop(): Promise<void> {
    if (this.booted && this.udid) await this.simctl('shutdown', this.udid).catch(() => undefined);
    this.booted = false;
  }

  async snapshot(): Promise<Outline> {
    if (!this.t.idb) throw new Error(`Reading the screen needs idb. ${IDB_HINT}. Meanwhile, use device_screenshot.`);
    return iosOutline((await this.idb('ui', 'describe-all', '--json')).stdout.toString());
  }

  async tap(x: number, y: number) { await this.idb('ui', 'tap', String(Math.round(x)), String(Math.round(y))); }
  async type(text: string) { await this.idb('ui', 'text', text); }
  async swipe(dir: 'up' | 'down' | 'left' | 'right') { const { w, h } = await this.screenSize(); await this.idb('ui', 'swipe', ...swipeLine(w, h, dir)); }
  async press(key: DeviceKey) {
    if (key === 'back') throw new Error('iOS has no Back button; swipe right from the left edge or tap the app\'s back control.');
    if (key === 'home') await this.idb('ui', 'button', 'HOME');
    else await this.idb('ui', 'key', { enter: '40', delete: '42', tab: '43' }[key]);
  }
  async install(file: string) { await this.simctl('install', this.id(), file); }
  async launch(appId: string) { await this.simctl('launch', this.id(), appId); }
  async openUrl(url: string) { await this.simctl('openurl', this.id(), url); }
  async screenshot(): Promise<Buffer> { return (await ok(runTool(this.xcrun, ['simctl', 'io', this.id(), 'screenshot', '--type=png', '-'], SHOT), 'Screenshot')).stdout; }
  async logs() {
    const r = await runTool(this.xcrun, ['simctl', 'spawn', this.id(), 'log', 'show', '--last', '2m', '--style', 'compact', '--predicate', 'messageType >= 16']);
    return r.stdout.toString().split('\n').slice(-200).join('\n') || 'No errors.';
  }
  /** Taps are in points: the Application element's frame from idb (screenshots are in pixels). */
  async screenSize() {
    if (this.size) return this.size;
    const app = (JSON.parse((await this.idb('ui', 'describe-all', '--json')).stdout.toString()) as { type?: string; frame?: { width: number; height: number } }[]).find((e) => e.type === 'Application');
    this.size = need(app?.frame ? { w: app.frame.width, h: app.frame.height } : undefined, 'Could not read the screen size');
    return this.size;
  }
}
