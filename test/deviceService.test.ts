import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceService } from '../src/main/devices/deviceService';
import { AndroidDriver } from '../src/main/devices/drivers';
import { resolveDeviceTools } from '../src/main/devices/tools';
import { fakeDevices } from './helpers/fakeDevices';

let fake: Awaited<ReturnType<typeof fakeDevices>>;
let svc: DeviceService;
const frames: string[] = [];
beforeEach(async () => {
  fake = await fakeDevices();
  frames.length = 0;
  svc = new DeviceService({
    tools: resolveDeviceTools({}, 'darwin', fake.override), bootMs: 10_000, frameMs: 50,
    nameOf: (id) => ({ a1: 'Pixel', a2: 'Byte' })[id] ?? id, taskOf: (id) => ({ a1: 'T-101', a2: 'T-102' })[id],
    onFrame: (f) => { frames.push(f.agentId); svc.ack(); },
  });
});
afterEach(async () => { await svc.close(); await fake.cleanup(); });

describe('DeviceService', () => {
  it('lets one employee hold a device at a time and frees it when their work ends', async () => {
    await svc.use('a1', 'android');
    await expect(svc.use('a2', 'android')).rejects.toThrow('The Android emulator is in use by Pixel (T-101). Try again when that task is finished, or ask the boss to sequence the work.');
    expect(await svc.use('a1', 'android')).toBeTruthy(); // the holder keeps using it
    svc.release('a1');
    await expect(svc.use('a2', 'android')).resolves.toBeTruthy();
    expect((await svc.states()).find((s) => s.kind === 'android')).toMatchObject({ running: true, holder: 'a2', startedByApp: true });
  });

  it('streams frames of the watched device and passes clicks as taps in device units', async () => {
    await svc.use('a1', 'android');
    svc.watch('android');
    await new Promise((r) => setTimeout(r, 400));
    expect(frames.length).toBeGreaterThan(0);
    expect(new Set(frames)).toEqual(new Set(['device:android']));
    const from = (await fake.calls()).length;
    await svc.input('android', { kind: 'click', x: 0.5, y: 0.5, button: 'left' });
    expect((await fake.calls()).slice(from)).toContainEqual(expect.arrayContaining(['input', 'tap', '2', '4']));
    expect(svc.takeUserNote('a1', 'android')).toMatch(/user/i);
    svc.watch(null);
  });

  it('shuts down devices it started on close, and leaves the user\'s own running', async () => {
    await svc.use('a1', 'ios');
    await svc.close();
    expect((await fake.calls()).at(-1)).toEqual(['xcrun', 'simctl', 'shutdown', 'SIM-1']);
  });

  it('reports a missing platform plainly', async () => {
    const none = new DeviceService({ tools: { platform: 'linux' }, nameOf: (x) => x, taskOf: () => undefined });
    await expect(none.use('a1', 'ios')).rejects.toThrow(/macOS/);
    await none.close();
  });
});

describe('DeviceService while a device is booting', () => {
  it('still shuts down a device the app was starting when the project closes', async () => {
    const stop = vi.fn(async () => undefined);
    const slow = {
      kind: 'android' as const, canInput: true,
      start: () => new Promise<{ kind: 'android'; id: string; name: string; startedByApp: boolean }>((r) => setTimeout(() => r({ kind: 'android', id: 'emulator-5554', name: 'Phone', startedByApp: true }), 300)),
      running: async () => true, stop,
    } as unknown as import('../src/main/devices/drivers').DeviceDriver;
    const s = new DeviceService({ tools: { platform: 'linux' }, nameOf: (x) => x, taskOf: () => undefined, drivers: { android: slow } });
    const using = s.use('a1', 'android');
    await new Promise((r) => setTimeout(r, 50));
    await s.close(); // the boot is still going
    await using.catch(() => undefined);
    expect(stop).toHaveBeenCalled();
  });
});

describe('DeviceService with a device the user started', () => {
  it('attaches to it and leaves it running when the project closes', async () => {
    const f = await fakeDevices();
    const tools = resolveDeviceTools({}, 'darwin', f.override);
    const users = new AndroidDriver(tools, { bootMs: 10_000 });
    await users.start(); // "the user's" emulator
    const s = new DeviceService({ tools, bootMs: 10_000, nameOf: (x) => x, taskOf: () => undefined });
    await s.use('a1', 'android');
    expect((await s.states()).find((x) => x.kind === 'android')).toMatchObject({ startedByApp: false });
    const before = (await f.calls()).length;
    await s.close();
    expect((await f.calls()).slice(before).some((c) => c.includes('kill'))).toBe(false);
    expect(await users.running()).toBe(true);
    await users.stop();
    await f.cleanup();
  });
});
