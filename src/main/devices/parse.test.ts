import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { adbText, adbTextChunks, freeEmulatorPort, androidOutline, shQuote, androidUrl, insideWorktree, iosOutline, parseAdbDevices, parseAvds, parseSimulators, pngSize } from './parse';

const XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0"><node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.example" content-desc="" clickable="false" bounds="[0,0][1080,2400]"><node index="0" text="Sign in &amp; go" resource-id="com.example:id/title" class="android.widget.TextView" content-desc="" clickable="false" bounds="[100,200][980,300]" /><node index="1" text="" resource-id="com.example:id/email" class="android.widget.EditText" content-desc="Email" clickable="true" bounds="[100,400][980,520]" /><node index="2" text="Continue" resource-id="com.example:id/go" class="android.widget.Button" content-desc="" clickable="true" bounds="[100,600][980,720]" /></node></hierarchy>UI hierchary dumped to: /dev/tty`;

const IDB = JSON.stringify([
  { AXLabel: null, AXValue: null, type: 'Application', frame: { x: 0, y: 0, width: 402, height: 874 } },
  { AXLabel: 'Sign in', AXValue: null, type: 'StaticText', frame: { x: 20, y: 100, width: 200, height: 30 } },
  { AXLabel: 'Email', AXValue: '', type: 'TextField', frame: { x: 20, y: 200, width: 360, height: 44 } },
  { AXLabel: 'Continue', AXValue: null, type: 'Button', frame: { x: 20, y: 300, width: 360, height: 50 } },
]);

describe('androidOutline', () => {
  it('lists labelled and clickable nodes with refs at their centres', () => {
    const o = androidOutline(XML);
    expect(o.text.split('\n')).toEqual([
      '- TextView "Sign in & go" [ref=a1]',
      '- EditText "Email" (clickable) [ref=a2]',
      '- Button "Continue" (clickable) [ref=a3]',
    ]);
    expect(o.refs.get('a3')).toEqual({ x: 540, y: 660 });
  });
  it('says when the screen has nothing to read', () => {
    expect(androidOutline('<hierarchy></hierarchy>').text).toBe('(no readable elements on screen)');
  });
});

describe('iosOutline', () => {
  it('lists labelled elements with refs at their centres, in points', () => {
    const o = iosOutline(IDB);
    expect(o.text.split('\n')).toEqual(['- StaticText "Sign in" [ref=i1]', '- TextField "Email" [ref=i2]', '- Button "Continue" [ref=i3]']);
    expect(o.refs.get('i3')).toEqual({ x: 200, y: 325 });
  });
});

describe('tool output parsing', () => {
  it('reads adb devices, AVDs and simulators', () => {
    expect(parseAdbDevices('List of devices attached\nemulator-5554\tdevice\nemulator-5556\toffline\nR58M\tdevice\n\n')).toEqual(['emulator-5554']);
    expect(parseAvds('INFO    | Storing crashdata\nMedium_Phone\nPixel_8\n')).toEqual(['Medium_Phone', 'Pixel_8']);
    const sims = parseSimulators(JSON.stringify({ devices: {
      'com.apple.CoreSimulator.SimRuntime.iOS-18-0': [{ udid: 'A', name: 'iPhone 16', state: 'Shutdown', isAvailable: true }],
      'com.apple.CoreSimulator.SimRuntime.iOS-26-0': [{ udid: 'B', name: 'iPhone 17', state: 'Booted', isAvailable: true }, { udid: 'C', name: 'iPad Air', state: 'Shutdown', isAvailable: true }, { udid: 'D', name: 'iPhone Old', state: 'Shutdown', isAvailable: false }],
    } }));
    expect(sims.map((s) => s.udid)).toEqual(['B', 'A']);
    expect(sims[0]).toMatchObject({ name: 'iPhone 17', runtime: 'iOS 26.0', state: 'Booted' });
  });
});

describe('adbText', () => {
  it('escapes spaces and shell characters for the device shell', () => {
    expect(adbText('a&b "c" $d')).toBe('a\\&b%s\\"c\\"%s\\$d');
    expect(adbText("it's (ok)")).toBe("it\\'s%s\\(ok\\)");
    expect(() => adbText('héllo')).toThrow(/ASCII/);
  });
});

describe('androidUrl', () => {
  it('points local addresses at the host as the emulator sees it', () => {
    expect(androidUrl('http://localhost:5173/a?b=1')).toBe('http://10.0.2.2:5173/a?b=1');
    expect(androidUrl('http://127.0.0.1:3000/')).toBe('http://10.0.2.2:3000/');
    expect(androidUrl('http://[::1]:3000/')).toBe('http://10.0.2.2:3000/');
  });
});

describe('pngSize', () => {
  it('reads width and height from a PNG header', () => {
    const b = Buffer.alloc(24);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    b.writeUInt32BE(1080, 16); b.writeUInt32BE(2400, 20);
    expect(pngSize(b)).toEqual({ w: 1080, h: 2400 });
    expect(pngSize(Buffer.from('nope'))).toBeNull();
  });
});

describe('insideWorktree', () => {
  let root: string; let outside: string;
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-wt-'));
    outside = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-out-'));
    await fs.mkdir(path.join(root, 'build'), { recursive: true });
    await fs.writeFile(path.join(root, 'build', 'app.apk'), 'x');
    await fs.writeFile(path.join(outside, 'evil.apk'), 'x');
    await fs.symlink(path.join(outside, 'evil.apk'), path.join(root, 'link.apk')).catch(() => undefined);
  });
  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    await fs.rm(outside, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
  it('accepts files inside the worktree and refuses everything else', async () => {
    expect(await insideWorktree(root, 'build/app.apk')).toBe(await fs.realpath(path.join(root, 'build', 'app.apk')));
    await expect(insideWorktree(root, '../' + path.basename(outside) + '/evil.apk')).rejects.toThrow(/inside your folder/);
    await expect(insideWorktree(root, path.join(outside, 'evil.apk'))).rejects.toThrow(/inside your folder/);
    if (process.platform !== 'win32') await expect(insideWorktree(root, 'link.apk')).rejects.toThrow(/inside your folder/);
    await expect(insideWorktree(root, 'missing.apk')).rejects.toThrow(/not found/);
  });
});

describe('shQuote', () => {
  it('quotes a value for the device shell so & ; $() and quotes stay literal', () => {
    expect(shQuote("http://10.0.2.2:3000/a?x=1&y=$(id);z|w")).toBe("'http://10.0.2.2:3000/a?x=1&y=$(id);z|w'");
    expect(shQuote("it's")).toBe("'it'\\''s'");
  });
});

describe('review follow-ups', () => {
  it('types a literal %s by splitting it across two input commands', () => {
    expect(adbTextChunks('50%sale now')).toEqual(['50%', 'sale%snow']);
    expect(adbTextChunks('plain')).toEqual(['plain']);
  });

  it('accepts names that only start with two dots', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-dots-'));
    await fs.mkdir(path.join(root, '..build'));
    await fs.writeFile(path.join(root, '..build', 'app.apk'), 'x');
    expect(await insideWorktree(root, '..build/app.apk')).toBe(await fs.realpath(path.join(root, '..build', 'app.apk')));
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  it('picks an emulator port no other emulator uses, even one still booting', () => {
    expect(freeEmulatorPort('List of devices attached\nemulator-5554\tdevice\nemulator-5556\toffline\n')).toBe(5558);
    expect(freeEmulatorPort('List of devices attached\n')).toBe(5554);
  });
});
