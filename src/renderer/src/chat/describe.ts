const s = (v: unknown) => (typeof v === 'string' ? v : '');
const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}…` : t);

export function describeToolCall(tool: string, input: Record<string, unknown>): string {
  switch (tool) {
    case 'assign_task': return `${s(input.agent)}: ${s(input.title)}`;
    case 'hire': return input.name ? `${s(input.role_id)} as ${s(input.name)}` : s(input.role_id);
    case 'message_agent': return `${s(input.agent)}: ${clip(s(input.text), 60)}`;
    case 'get_task':
    case 'request_merge':
    case 'cancel_task': return s(input.task_id);
    case 'report_to_user': return clip(s(input.text), 80);
    case 'list_team':
    case 'list_roles':
    case 'list_tasks': return input.status ? s(input.status) : '';
    default: return clip(JSON.stringify(input), 120);
  }
}
