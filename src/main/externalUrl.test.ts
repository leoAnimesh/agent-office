import { describe, expect, it } from 'vitest';
import { isWebUrl } from './externalUrl';

describe('isWebUrl', () => {
  it('only allows http and https links', () => {
    expect(isWebUrl('https://github.com/leoAnimesh/agent-office/pull/3')).toBe(true);
    expect(isWebUrl('http://localhost:3000/')).toBe(true);
    for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'mailto:a@b.c', 'vscode://x', 'not a url', '']) expect(isWebUrl(bad)).toBe(false);
  });
});
