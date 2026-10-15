import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectDevices, resolveDeviceTools, runTool } from '../src/main/devices/tools';
import { fakeDevices } from './helpers/fakeDevices';

let fake: Awaited<ReturnType<typeof fakeDevices>>;
beforeEach(async () => { fake = await fakeDevices(); });
afterEach(async () => { await fake.cleanup(); });

describe('device tools', () => {
  it('runs a tool with an args array and returns its output', async () => {
    const t = resolveDeviceTools({}, 'linux', fake.override);
    const r = await runTool(t.adb!, ['devices']);
    expect(r.code).toBe(0);
    expect(r.stdout.toString()).toContain('List of devices attached');
    expect(await fake.calls()).toEqual([['adb', 'devices']]);
  });

  it('times out a tool that hangs', async () => {
    const t = resolveDeviceTools({}, 'linux', fake.override);
    await expect(runTool({ bin: process.execPath, pre: ['-e', 'setTimeout(() => {}, 60000)'] }, [], { timeoutMs: 300 })).rejects.toThrow(/timed out/);
    expect(t.platform).toBe('darwin');
  });

  it('reports what is available', async () => {
    const support = await detectDevices(resolveDeviceTools({}, 'darwin', fake.override));
    expect(support.android).toMatchObject({ ok: true, avds: ['Medium_Phone'] });
    expect(support.ios).toMatchObject({ ok: true, idb: true, devices: [{ udid: 'SIM-1', name: 'iPhone 17' }] });
  });

  it('explains what is missing', async () => {
    const none = await detectDevices({ platform: 'linux' });
    expect(none.android).toMatchObject({ ok: false, reason: expect.stringMatching(/Android SDK/) });
    expect(none.ios).toMatchObject({ ok: false, reason: expect.stringMatching(/macOS/) });
  });

  it('finds the Android SDK from ANDROID_HOME and the default folders', () => {
    if (process.platform === 'win32') return; // POSIX paths in this check
    const t = resolveDeviceTools({ ANDROID_HOME: '/sdk' }, 'linux', undefined, (p) => p === '/sdk/platform-tools/adb' || p === '/sdk/emulator/emulator');
    expect(t.adb).toEqual({ bin: '/sdk/platform-tools/adb', pre: [] });
    expect(t.emulator).toEqual({ bin: '/sdk/emulator/emulator', pre: [] });
  });
});
