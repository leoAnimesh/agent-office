import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceService } from '../src/main/devices/deviceService';
import { deviceTools } from '../src/main/devices/deviceTools';
import { resolveDeviceTools } from '../src/main/devices/tools';
import type { Shrink } from '../src/main/devices/shrink';
import { fakeDevices } from './helpers/fakeDevices';

let fake: Awaited<ReturnType<typeof fakeDevices>>;
beforeEach(async () => { fake = await fakeDevices(); });
afterEach(async () => { await fake.cleanup(); });

describe('device images are shrunk', () => {
  it('sends the model a scaled JPEG screenshot and the live view a smaller one', async () => {
    const shrink: Shrink = vi.fn(async (_png: Buffer, maxSide: number) => ({ data: Buffer.from(`jpeg-${maxSide}`), mime: 'image/jpeg', w: 10, h: 20 }));
    const frames: { mime?: string; data: string }[] = [];
    const devices = new DeviceService({ tools: resolveDeviceTools({}, 'darwin', fake.override), bootMs: 10_000, frameMs: 50, shrink, nameOf: (x) => x, taskOf: () => undefined, onFrame: (f) => { frames.push(f); devices.ack(); } });
    const tools = deviceTools({ devices, worktreeOf: () => undefined, shrink });
    const shot = (await tools.find((t) => t.name === 'device_screenshot')!.run({ platform: 'android' }, { agentId: 'a1' })) as { mimeType: string; data: string };
    expect(shot.mimeType).toBe('image/jpeg');
    expect(Buffer.from(shot.data, 'base64').toString()).toBe('jpeg-1568');
    devices.watch('android');
    await new Promise((r) => setTimeout(r, 300));
    devices.watch(null);
    expect(frames[0]).toMatchObject({ mime: 'image/jpeg' });
    expect(Buffer.from(frames[0].data, 'base64').toString()).toBe('jpeg-900');
    await devices.close();
  });
});
