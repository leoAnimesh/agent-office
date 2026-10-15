import type { PermissionMode } from '../../shared/types';

export interface ClaudeLaunch {
  model?: string;
  permissionMode?: PermissionMode;
  allowedTools?: string[];
  appendSystemPromptFile?: string;
  mcpConfigPath?: string;
  sessionId?: string;
  resume?: string;
  /** Stream the reply as it is written (adds `stream_event` text deltas). */
  includePartialMessages?: boolean;
  /** Restrict the built-in tools to exactly these (MCP tools stay available). */
  tools?: string[];
  /** Extra folders the agent may read (e.g. chat attachments). */
  addDirs?: string[];
  /** Load only project/local settings so the user's global hooks and plugins stay out. */
  isolateUserSettings?: boolean;
}

export function buildClaudeArgs(l: ClaudeLaunch): string[] {
  const a = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'];
  if (l.model) a.push('--model', l.model);
  if (l.permissionMode) a.push('--permission-mode', l.permissionMode);
  if (l.appendSystemPromptFile) a.push('--append-system-prompt-file', l.appendSystemPromptFile);
  if (l.mcpConfigPath) a.push('--mcp-config', l.mcpConfigPath, '--strict-mcp-config');
  if (l.resume) a.push('--resume', l.resume);
  else if (l.sessionId) a.push('--session-id', l.sessionId);
  if (l.isolateUserSettings) a.push('--setting-sources', 'project,local');
  if (l.includePartialMessages) a.push('--include-partial-messages');
  if (l.addDirs && l.addDirs.length > 0) a.push('--add-dir', ...l.addDirs);
  if (l.tools) a.push('--tools', ...(l.tools.length > 0 ? l.tools : ['']));
  // Variadic flag goes last so it cannot swallow anything after it.
  if (l.allowedTools && l.allowedTools.length > 0) a.push('--allowedTools', ...l.allowedTools);
  return a;
}

export interface ImageBlock { mime: string; base64: string }
/** A user turn: plain text, or text with images the model can see. */
export type UserMessage = string | { text: string; images: ImageBlock[] };

export function userMessageLine(msg: UserMessage): string {
  if (typeof msg === 'string' || msg.images.length === 0) {
    const text = typeof msg === 'string' ? msg : msg.text;
    return JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n';
  }
  const content = [
    ...(msg.text.trim() ? [{ type: 'text', text: msg.text }] : []),
    ...msg.images.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.base64 } })),
  ];
  return JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n';
}
