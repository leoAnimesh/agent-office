import type { RunnerEvent } from '../../shared/types';

export class LineSplitter {
  private buf = '';

  push(chunk: string): string[] {
    this.buf += chunk;
    const parts = this.buf.split(/\r?\n/);
    this.buf = parts.pop() ?? '';
    return parts.map((l) => l.trim()).filter((l) => l.length > 0);
  }

  flush(): string[] {
    const rest = this.buf.trim();
    this.buf = '';
    return rest ? [rest] : [];
  }
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => (isObj(c) && typeof c.text === 'string' ? c.text : '')).join('');
  return '';
}

export function parseLine(line: string): RunnerEvent[] {
  let d: unknown;
  try {
    d = JSON.parse(line);
  } catch {
    return [{ type: 'raw', text: line.slice(0, 500) }];
  }
  if (!isObj(d)) return [];

  switch (d.type) {
    case 'system':
      if (d.subtype === 'init') return [{ type: 'init', sessionId: String(d.session_id ?? ''), model: String(d.model ?? '') }];
      return [];
    case 'assistant': {
      const content = isObj(d.message) ? d.message.content : undefined;
      if (!Array.isArray(content)) return [];
      const out: RunnerEvent[] = [];
      for (const c of content) {
        if (!isObj(c)) continue;
        if (c.type === 'text' && typeof c.text === 'string' && c.text.trim()) out.push({ type: 'text', text: c.text });
        else if (c.type === 'thinking') out.push({ type: 'thinking' });
        else if (c.type === 'tool_use') out.push({ type: 'tool_use', id: String(c.id ?? ''), name: String(c.name ?? ''), input: isObj(c.input) ? c.input : {} });
      }
      return out;
    }
    case 'user': {
      const content = isObj(d.message) ? d.message.content : undefined;
      if (!Array.isArray(content)) return [];
      return content
        .filter((c): c is Json => isObj(c) && c.type === 'tool_result')
        .map((c) => ({ type: 'tool_result' as const, toolUseId: String(c.tool_use_id ?? ''), isError: c.is_error === true, preview: textOf(c.content).slice(0, 300) }));
    }
    case 'result':
      return [{
        type: 'result',
        ok: d.is_error !== true && d.subtype === 'success',
        text: typeof d.result === 'string' ? d.result : String(d.subtype ?? ''),
        sessionId: String(d.session_id ?? ''),
        costUsd: Number(d.total_cost_usd ?? 0),
        durationMs: Number(d.duration_ms ?? 0),
        numTurns: Number(d.num_turns ?? 0),
      }];
    default:
      return [];
  }
}
