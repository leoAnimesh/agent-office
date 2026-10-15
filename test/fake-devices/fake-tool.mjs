#!/usr/bin/env node
// Stand-in for adb, emulator, xcrun and idb. State lives in FAKE_DEVICE_DIR; every call is logged to calls.jsonl.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const [tool, ...args] = process.argv.slice(2);
const dir = process.env.FAKE_DEVICE_DIR;
const file = (n) => path.join(dir, n);
const has = (n) => fs.existsSync(file(n));
fs.appendFileSync(file('calls.jsonl'), JSON.stringify([tool, ...args]) + '\n');
const out = (s) => process.stdout.write(s);
// A real 4×8 teal PNG, so the live view can draw it.
const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(4, 0); ihdr.writeUInt32BE(8, 4); ihdr[8] = 8; ihdr[9] = 2;
const rows = Buffer.concat(Array.from({ length: 8 }, () => Buffer.from([0, ...Array.from({ length: 4 }, () => [47, 158, 143]).flat()])));
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
const XML = "<?xml version='1.0' ?><hierarchy><node text=\"Continue\" class=\"android.widget.Button\" clickable=\"true\" bounds=\"[0,0][4,8]\" /></hierarchy>";

if (tool === 'emulator') {
  if (args[0] === '-list-avds') { out('Medium_Phone\n'); process.exit(0); }
  if (args[0] === '-avd') {
    fs.writeFileSync(file('android-booted'), args[args.indexOf('-port') + 1] ?? '5554');
    setInterval(() => { if (!has('android-booted')) process.exit(0); }, 100);
  }
} else if (tool === 'adb') {
  const a = args[0] === '-s' ? args.slice(2) : args;
  if (a[0] === 'devices') { out(`List of devices attached\n${has('android-booted') ? `emulator-${fs.readFileSync(file('android-booted'), 'utf8')}\tdevice\n` : ''}\n`); }
  else if (a[0] === 'wait-for-device') { /* ready */ }
  else if (a[0] === 'shell' && a[1] === 'getprop') out('1\n');
  else if (a[0] === 'exec-out' && a[1] === 'uiautomator') out(`${XML}UI hierchary dumped to: /dev/tty`);
  else if (a[0] === 'exec-out' && a[1] === 'screencap') process.stdout.write(PNG);
  else if (a[0] === 'install') out('Performing Streamed Install\nSuccess\n');
  else if (a[0] === 'logcat') out('E/App: boom\n');
  else if (a[0] === 'emu' && a[1] === 'kill') fs.rmSync(file('android-booted'), { force: true });
} else if (tool === 'xcrun') {
  const a = args[0] === 'simctl' ? args.slice(1) : args;
  if (a[0] === 'list') out(JSON.stringify({ devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-26-0': [{ udid: 'SIM-1', name: 'iPhone 17', state: has('ios-booted') ? 'Booted' : 'Shutdown', isAvailable: true }] } }));
  else if (a[0] === 'boot') fs.writeFileSync(file('ios-booted'), a[1]);
  else if (a[0] === 'shutdown') fs.rmSync(file('ios-booted'), { force: true });
  else if (a[0] === 'io') process.stdout.write(PNG);
  else if (a[0] === 'spawn') out('Error: boom\n');
} else if (tool === 'idb') {
  if (args[0] === 'ui' && args[1] === 'describe-all') out(JSON.stringify([
    { AXLabel: null, type: 'Application', frame: { x: 0, y: 0, width: 2, height: 4 } },
    { AXLabel: 'Continue', type: 'Button', frame: { x: 0, y: 0, width: 2, height: 4 } },
  ]));
}
