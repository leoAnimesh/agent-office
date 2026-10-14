import { describe, expect, it } from 'vitest';
import { ApprovalBroker } from './approvalBroker';

const req = { taskId: 'T-1', title: 't', agentName: 'Pixel', diffStat: [], summary: 's' };

describe('ApprovalBroker', () => {
  it('resolves a decision once and lists pending requests', async () => {
    const b = new ApprovalBroker();
    const { requestId, decision } = b.request(req);
    expect(b.pending()).toEqual([{ ...req, requestId }]);
    expect(b.answer(requestId, true)).toBe(true);
    expect(await decision).toBe(true);
    expect(b.answer(requestId, false)).toBe(false);
    expect(b.pending()).toEqual([]);
  });

  it('rejects everything on shutdown', async () => {
    const b = new ApprovalBroker();
    const a = b.request(req);
    const c = b.request({ ...req, taskId: 'T-2' });
    b.rejectAll();
    expect(await a.decision).toBe(false);
    expect(await c.decision).toBe(false);
    expect(b.pending()).toEqual([]);
  });
});
