import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DeviceService } from '../src/main/devices/deviceService';
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
