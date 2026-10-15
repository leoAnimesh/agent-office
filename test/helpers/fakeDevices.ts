import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DeviceToolsOverride } from '../../src/main/devices/tools';

const FAKE = path.resolve('test/fake-devices/fake-tool.mjs');

/** Fake adb / emulator / xcrun / idb sharing one state folder (FAKE_DEVICE_DIR is set on process.env). */
export async function fakeDevices(opts: { idb?: boolean } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-dev-'));
  process.env.FAKE_DEVICE_DIR = dir;
  const cmd = (tool: string) => [process.execPath, FAKE, tool];
  const override: DeviceToolsOverride = { adb: cmd('adb'), emulator: cmd('emulator'), xcrun: cmd('xcrun'), platform: 'darwin', ...(opts.idb === false ? {} : { idb: cmd('idb') }) };
  return {
    dir, override,
    async calls(): Promise<string[][]> {
      const raw = await fs.readFile(path.join(dir, 'calls.jsonl'), 'utf8').catch(() => '');
      return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l) as string[]);
    },
    async cleanup() { await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); },
  };
}
