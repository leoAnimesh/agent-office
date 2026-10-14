import { describe, expect, it } from 'vitest';
import { isTrustedSender } from './ipcGuard';

describe('isTrustedSender', () => {
  it('accepts the packaged app page and the dev server only', () => {
    expect(isTrustedSender('file:///Applications/AgentOffice.app/Contents/Resources/app.asar/out/renderer/index.html', undefined)).toBe(true);
    expect(isTrustedSender('http://localhost:5173/', 'http://localhost:5173')).toBe(true);
    expect(isTrustedSender('http://localhost:5173/', undefined)).toBe(false);
    expect(isTrustedSender('https://evil.example/', 'http://localhost:5173')).toBe(false);
    expect(isTrustedSender(undefined, undefined)).toBe(false);
  });
});
