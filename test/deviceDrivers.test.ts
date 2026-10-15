import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { AndroidDriver, IosDriver } from '../src/main/devices/drivers';
import { resolveDeviceTools } from '../src/main/devices/tools';
import { fakeDevices } from './helpers/fakeDevices';

let fake: Awaited<ReturnType<typeof fakeDevices>>;
beforeEach(async () => { fake = await fakeDevices(); });
afterEach(async () => { await fake.cleanup(); });
const tools = () => resolveDeviceTools({}, 'darwin', fake.override);
const after = async (from: number) => (await fake.calls()).slice(from);

describe('AndroidDriver', () => {
  it('starts the emulator headless, waits for boot, and stops only what it started', async () => {
    const d = new AndroidDriver(tools(), { bootMs: 10_000 });
    const info = await d.start();
    expect(info).toMatchObject({ kind: 'android', name: 'Medium_Phone', startedByApp: true });
    const avd = (await fake.calls()).find((c) => c[0] === 'emulator' && c[1] === '-avd')!;
    expect(avd).toEqual(expect.arrayContaining(['-no-window', '-no-audio', '-no-boot-anim', '-no-snapshot-save']));
    expect(await d.running()).toBe(true);
    await d.stop();
    expect(await d.running()).toBe(false);
  });

  it('fails fast with a plain reason when the emulator cannot start', async () => {
    process.env.FAKE_EMULATOR_PANIC = '1';
    try {
      const d = new AndroidDriver(tools(), { bootMs: 60_000 });
      const started = Date.now();
      await expect(d.start()).rejects.toThrow(/system image is not installed[\s\S]*PANIC: Cannot find AVD system path/);
      expect(Date.now() - started).toBeLessThan(10_000);
    } finally { delete process.env.FAKE_EMULATOR_PANIC; }
  });

  it('attaches to a running emulator and leaves it running on stop', async () => {
    const starter = new AndroidDriver(tools(), { bootMs: 10_000 });
    await starter.start();
    const d = new AndroidDriver(tools(), { bootMs: 10_000 });
    expect(await d.start()).toMatchObject({ startedByApp: false, id: expect.stringMatching(/^emulator-/) });
    await d.stop();
    expect(await d.running()).toBe(true);
    await starter.stop();
  });

  it('reads the screen, taps, types escaped text, swipes, presses keys and opens local URLs', async () => {
    const d = new AndroidDriver(tools(), { bootMs: 10_000 });
    await d.start();
    const from = (await fake.calls()).length;
    expect((await d.snapshot()).text).toBe('- Button "Continue" (clickable) [ref=a1]');
    await d.tap(2, 4);
    await d.type('a&b c');
    await d.swipe('up');
    await d.press('back');
    await d.openUrl('http://localhost:5173/');
    const shell = (await after(from)).filter((c) => c.includes('shell')).map((c) => c.slice(c.indexOf('shell') + 1).join(' '));
    expect(shell).toEqual([
      'input tap 2 4',
      'input text a\\&b%sc',
      expect.stringMatching(/^input swipe \d+ \d+ \d+ \d+ 250$/),
      'input keyevent KEYCODE_BACK',
      'am start -a android.intent.action.VIEW -d http://10.0.2.2:5173/',
    ]);
    expect((await d.screenshot()).subarray(1, 4).toString()).toBe('PNG');
    expect(await d.screenSize()).toEqual({ w: 4, h: 8 });
    expect(await d.logs()).toContain('boom');
    await d.stop();
  });
});

describe('IosDriver', () => {
  it('boots a simulator, taps in points, and shuts down only what it booted', async () => {
    const d = new IosDriver(tools(), { bootMs: 10_000 });
    expect(await d.start()).toMatchObject({ kind: 'ios', id: 'SIM-1', name: 'iPhone 17', startedByApp: true });
    expect(d.canInput).toBe(true);
    expect((await d.snapshot()).text).toBe('- Button "Continue" [ref=i1]');
    expect(await d.screenSize()).toEqual({ w: 2, h: 4 });
    const from = (await fake.calls()).length;
    await d.tap(1, 2);
    await d.type('hi there');
    await d.press('enter');
    await d.openUrl('http://localhost:3000/');
    expect(await after(from)).toEqual([
      ['idb', 'ui', 'tap', '1', '2', '--udid', 'SIM-1'],
      ['idb', 'ui', 'text', 'hi there', '--udid', 'SIM-1'],
      ['idb', 'ui', 'key', '40', '--udid', 'SIM-1'],
      ['xcrun', 'simctl', 'openurl', 'SIM-1', 'http://localhost:3000/'],
    ]);
    expect((await d.screenshot()).subarray(1, 4).toString()).toBe('PNG');
    expect(fs.existsSync('-')).toBe(false);
    await d.stop();
    expect((await fake.calls()).at(-1)).toEqual(['xcrun', 'simctl', 'shutdown', 'SIM-1']);
  });

  it('says what to install when idb is missing', async () => {
    const noIdb = await fakeDevices({ idb: false });
    const d = new IosDriver(resolveDeviceTools({}, 'darwin', noIdb.override), { bootMs: 10_000 });
    await d.start();
    expect(d.canInput).toBe(false);
    await expect(d.tap(1, 1)).rejects.toThrow(/brew install facebook\/fb\/idb-companion/);
    expect((await d.screenshot()).subarray(1, 4).toString()).toBe('PNG');
    await d.stop();
    await noIdb.cleanup();
  });
});
