import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DeviceService } from '../src/main/devices/deviceService';
import { deviceTools } from '../src/main/devices/deviceTools';
import { resolveDeviceTools } from '../src/main/devices/tools';
import type { ToolDef } from '../src/main/agents/bossTools';
import { fakeDevices } from './helpers/fakeDevices';

let fake: Awaited<ReturnType<typeof fakeDevices>>;
let devices: DeviceService;
let tools: ToolDef[];
let wt: string;
const call = (name: string, args: unknown, agentId = 'a1') => tools.find((t) => t.name === name)!.run(args, { agentId });

beforeEach(async () => {
  fake = await fakeDevices();
  wt = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-wt-'));
  await fs.writeFile(path.join(wt, 'app.apk'), 'apk');
  devices = new DeviceService({ tools: resolveDeviceTools({}, 'darwin', fake.override), bootMs: 10_000, nameOf: (id) => id, taskOf: () => undefined });
  tools = deviceTools({ devices, worktreeOf: () => wt });
});
afterEach(async () => { await devices.close(); await fake.cleanup(); await fs.rm(wt, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); });

describe('device tools', () => {
  it('exposes the documented tools', () => {
    expect(tools.map((t) => t.name).sort()).toEqual(['device_install', 'device_launch', 'device_logs', 'device_open_url', 'device_press', 'device_release', 'device_screenshot', 'device_snapshot', 'device_start', 'device_swipe', 'device_tap', 'device_type']);
  });

  it('starts, installs from the worktree, launches, reads, taps a ref, screenshots and releases', async () => {
    expect(await call('device_start', { platform: 'android' })).toMatchObject({ name: 'Medium_Phone', booted: true });
    expect(await call('device_install', { platform: 'android', path: 'app.apk' })).toEqual({ installed: 'app.apk' });
    await expect(call('device_install', { platform: 'android', path: '../x.apk' })).rejects.toThrow();
    expect(await call('device_launch', { platform: 'android', app_id: 'com.example' })).toEqual({ launched: 'com.example' });
    expect(await call('device_snapshot', { platform: 'android' })).toContain('[ref=a1]');
    expect(await call('device_tap', { platform: 'android', ref: 'a1' })).toEqual({ ok: true });
    await expect(call('device_tap', { platform: 'android', ref: 'a9' })).rejects.toThrow(/device_snapshot/);
    expect(await call('device_open_url', { platform: 'android', url: 'http://localhost:3000/' })).toEqual({ opened: 'http://localhost:3000/' });
    await expect(call('device_open_url', { platform: 'android', url: 'https://example.com' })).rejects.toThrow(/Only local addresses/);
    expect(await call('device_screenshot', { platform: 'android' })).toMatchObject({ type: 'image', mimeType: 'image/png' });
    expect(await call('device_release', { platform: 'android' })).toEqual({ released: true });
  });

  it('refuses calls without a caller', async () => {
    await expect(tools.find((t) => t.name === 'device_start')!.run({ platform: 'android' }, {})).rejects.toThrow(/employee/);
  });
});
