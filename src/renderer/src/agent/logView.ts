import type { LogEntry, Task } from '../../../shared/types';

export interface LogLine { time: string; kind: string; text: string; tone: 'tool' | 'result' | 'text' | 'bad' | 'meta' }

const time = (at: string) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const firstLine = (s: string) => s.split('\n')[0] ?? '';

function keyArg(input: Record<string, unknown>): string {
  for (const k of ['file_path', 'command', 'pattern', 'url', 'agent', 'task_id']) {
    if (typeof input[k] === 'string') return input[k] as string;
  }
  const json = JSON.stringify(input);
  return json.length > 120 ? `${json.slice(0, 119)}…` : json;
}

export function formatLog(entry: LogEntry): LogLine | null {
  const e = entry.event;
  const t = time(entry.at);
  switch (e.type) {
    case 'tool_use': return { time: t, kind: 'tool', text: `${e.name} ${keyArg(e.input)}`, tone: 'tool' };
    case 'tool_result': return { time: t, kind: 'result', text: firstLine(e.preview), tone: e.isError ? 'bad' : 'result' };
    case 'text': return { time: t, kind: 'text', text: e.text, tone: 'text' };
    case 'result': return e.ok ? { time: t, kind: 'done', text: firstLine(e.text), tone: 'result' } : { time: t, kind: 'failed', text: firstLine(e.text), tone: 'bad' };
    case 'stderr': return { time: t, kind: 'stderr', text: e.text, tone: 'bad' };
    case 'init': return { time: t, kind: 'start', text: `session started (${e.model})`, tone: 'meta' };
    case 'exit': return { time: t, kind: 'exit', text: `session ended (${e.code ?? e.signal})`, tone: 'meta' };
    default: return null;
  }
}

const OPEN: Task['status'][] = ['working', 'needs_help', 'review', 'queued'];

export function currentTask(agentId: string, tasks: Task[]): Task | undefined {
  const mine = tasks.filter((t) => t.assigneeId === agentId && OPEN.includes(t.status));
  return mine.find((t) => t.status === 'working') ?? mine.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}
