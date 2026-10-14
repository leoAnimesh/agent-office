import { describe, expect, it } from 'vitest';
import { readTestOverrides } from './testOverrides';

const env = { AO_USER_DATA: '/tmp/ud', AO_CLAUDE_BIN: '/x/node', AO_CLAUDE_ARGS: '["/x/fake.mjs", 3]', AO_CLAUDE_MISSING: '1', AO_E2E_PICK_FOLDER: '/repo', ELECTRON_RENDERER_URL: 'http://localhost:5173' };

describe('readTestOverrides', () => {
  it('reads the test hooks in development', () => {
    expect(readTestOverrides(env, false)).toEqual({ userData: '/tmp/ud', claudeBin: '/x/node', claudeArgs: ['/x/fake.mjs'], claudeMissing: true, pickFolder: '/repo', rendererUrl: 'http://localhost:5173' });
  });

  it('ignores every hook in a packaged build', () => {
    expect(readTestOverrides(env, true)).toEqual({ claudeArgs: [], claudeMissing: false });
  });

  it('tolerates broken JSON', () => {
    expect(readTestOverrides({ AO_CLAUDE_ARGS: '{nope' }, false).claudeArgs).toEqual([]);
  });
});
