import { randomUUID } from 'node:crypto';
import type { MergeRequest } from '../../shared/types';

interface Pending { request: MergeRequest; resolve: (ok: boolean) => void }

export class ApprovalBroker {
  private readonly items = new Map<string, Pending>();

  request(r: Omit<MergeRequest, 'requestId'>, requestId: string = randomUUID()): { requestId: string; decision: Promise<boolean> } {
    const decision = new Promise<boolean>((resolve) => {
      this.items.set(requestId, { request: { ...r, requestId }, resolve });
    });
    return { requestId, decision };
  }

  answer(requestId: string, ok: boolean): boolean {
    const p = this.items.get(requestId);
    if (!p) return false;
    this.items.delete(requestId);
    p.resolve(ok);
    return true;
  }

  pending(): MergeRequest[] {
    return [...this.items.values()].map((p) => p.request);
  }

  rejectAll(): void {
    for (const id of [...this.items.keys()]) this.answer(id, false);
  }
}
