import type { AgentStatus, RunnerEvent } from '../../shared/types';

export interface LiveState { status: AgentStatus; bubble: string }

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const base = (p: unknown) => String(p ?? '').split(/[\\/]/).filter(Boolean).pop() ?? '';

export function describeTool(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Read': return `Reading ${base(input.file_path)}`;
    case 'Edit':
    case 'MultiEdit': return `Editing ${base(input.file_path)}`;
    case 'Write': return `Writing ${base(input.file_path)}`;
    case 'Bash': return `Running ${clip(String(input.command ?? ''), 24)}`;
    case 'Grep':
    case 'Glob': return `Searching "${clip(String(input.pattern ?? ''), 24)}"`;
    case 'WebFetch':
    case 'WebSearch': return 'Browsing the web';
    case 'Task':
    case 'Agent': return 'Delegating a subtask';
  }
  if (name.startsWith('mcp__')) {
    const tool = name.split('__').pop() ?? name;
    if (tool === 'assign_task') return `Assigning ${String(input.agent ?? 'a task')}`;
    return `Using ${tool}`;
  }
  return `Using ${name}`;
}

export function reduceStatus(prev: LiveState, ev: RunnerEvent): LiveState {
  switch (ev.type) {
    case 'init': return { status: 'thinking', bubble: 'Starting…' };
    case 'thinking': return { status: 'thinking', bubble: 'Thinking…' };
    case 'text': return { status: 'thinking', bubble: clip(ev.text.replace(/\s+/g, ' ').trim(), 40) };
    case 'tool_use': return { status: 'working', bubble: describeTool(ev.name, ev.input) };
    case 'result': return ev.ok ? { status: 'done', bubble: 'Done' } : { status: 'error', bubble: 'Hit a problem' };
    case 'exit':
      if (prev.status === 'done' || prev.status === 'error' || prev.status === 'paused') return prev;
      if (prev.status === 'working' || ev.code !== 0) return { status: 'error', bubble: `Exited (${ev.code ?? ev.signal})` };
      return { status: 'idle', bubble: 'Idle' };
    default: return prev;
  }
}
