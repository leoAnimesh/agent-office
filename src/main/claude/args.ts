import type { PermissionMode } from '../../shared/types';

export interface ClaudeLaunch {
  model?: string;
  permissionMode?: PermissionMode;
  allowedTools?: string[];
  appendSystemPromptFile?: string;
  mcpConfigPath?: string;
  sessionId?: string;
  resume?: string;
  /** Restrict the built-in tools to exactly these (MCP tools stay available). */
  tools?: string[];
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
  if (l.tools) a.push('--tools', ...(l.tools.length > 0 ? l.tools : ['']));
  // Variadic flag goes last so it cannot swallow anything after it.
  if (l.allowedTools && l.allowedTools.length > 0) a.push('--allowedTools', ...l.allowedTools);
  return a;
}

export function userMessageLine(text: string): string {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n';
}
