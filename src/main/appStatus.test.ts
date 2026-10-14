import { describe, expect, it } from 'vitest';
import { getAppStatus } from './appStatus';

const locate = (files: string[]) => ({ platform: 'linux' as const, env: { PATH: '/usr/bin' }, home: '/home/u', isFile: (p: string) => files.includes(p) });

describe('getAppStatus', () => {
  it('reports the binary and version when found', () => {
    expect(getAppStatus({ locate: locate(['/usr/bin/claude']), version: () => '2.1.299' })).toEqual({
      platform: 'linux', claude: { path: '/usr/bin/claude', version: '2.1.299' },
    });
  });

  it('reports null when Claude Code is missing', () => {
    expect(getAppStatus({ locate: locate([]), version: () => '1.0.0' })).toEqual({ platform: 'linux', claude: null });
  });
});
