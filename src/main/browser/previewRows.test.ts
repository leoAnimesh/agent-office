import { describe, expect, it } from 'vitest';
import { previewRows } from './previewRows';

describe('previewRows', () => {
  it('lists every employee with a tab or a dev server, so a server without a tab can still be stopped', () => {
    const rows = previewRows(
      [{ agentId: 'a1', url: 'http://127.0.0.1:5000/', title: 'App' }],
      [{ agentId: 'a1', info: { url: 'http://127.0.0.1:5000/', port: 5000, command: 'npm run dev', running: true } },
        { agentId: 'a2', info: { url: 'http://127.0.0.1:6000/', port: 6000, command: 'npm run dev', running: true } }],
    );
    expect(rows).toEqual([
      { agentId: 'a1', url: 'http://127.0.0.1:5000/', title: 'App', devServer: { url: 'http://127.0.0.1:5000/', running: true } },
      { agentId: 'a2', url: '', title: '', devServer: { url: 'http://127.0.0.1:6000/', running: true } },
    ]);
  });
});
