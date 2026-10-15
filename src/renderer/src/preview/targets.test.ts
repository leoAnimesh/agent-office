import { describe, expect, it } from 'vitest';
import { deviceStatus, targetLabel } from './targets';

const nameOf = (id: string) => ({ a1: 'Pixel', a2: 'Byte' })[id] ?? 'Employee';
const dev = (over: object) => ({ agentId: 'device:android', url: '', title: '', devServer: null, device: { kind: 'android' as const, running: true, name: 'Medium_Phone', holder: 'a2', startedByApp: true, canInput: true, ...over } });

describe('preview targets', () => {
  it('labels browser tabs and devices', () => {
    expect(targetLabel({ agentId: 'a1', url: 'http://x/', title: '', devServer: null }, nameOf)).toBe('Pixel · browser');
    expect(targetLabel(dev({}), nameOf)).toBe('Android · Medium_Phone (Byte)');
    expect(targetLabel(dev({ kind: 'ios', name: 'iPhone 17', holder: null }), nameOf)).toBe('iOS · iPhone 17 (free)');
    expect(targetLabel(dev({ running: false, name: null, holder: null }), nameOf)).toBe('Android · not running');
  });
  it('describes a device and whether it can be used', () => {
    expect(deviceStatus(dev({}), nameOf)).toBe('Android · Medium_Phone · used by Byte');
    expect(deviceStatus(dev({ kind: 'ios', name: 'iPhone 17', holder: null, canInput: false }), nameOf)).toBe('iOS · iPhone 17 · free · view only (install idb to tap and type)');
    expect(deviceStatus(dev({ running: false }), nameOf)).toBe('Android · not running');
  });
});
