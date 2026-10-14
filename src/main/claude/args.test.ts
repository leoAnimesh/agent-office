import { describe, expect, it } from 'vitest';
import { buildClaudeArgs, userMessageLine } from './args';

describe('buildClaudeArgs', () => {
  it('always uses headless stream-json in and out', () => {
    expect(buildClaudeArgs({})).toEqual(['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose']);
  });

  it('adds every option, passing tools as separate args so patterns with commas survive', () => {
    const args = buildClaudeArgs({
      model: 'sonnet', permissionMode: 'acceptEdits', allowedTools: ['Read', 'Bash(npm run test, lint)'],
      appendSystemPromptFile: '/tmp/p.md', mcpConfigPath: '/tmp/mcp.json', sessionId: 'abc', isolateUserSettings: true,
    });
    expect(args).toEqual([
      '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--model', 'sonnet',
      '--permission-mode', 'acceptEdits',
      '--append-system-prompt-file', '/tmp/p.md',
      '--mcp-config', '/tmp/mcp.json', '--strict-mcp-config',
      '--session-id', 'abc',
      '--setting-sources', 'project,local',
      '--allowedTools', 'Read', 'Bash(npm run test, lint)',
    ]);
  });

  it('prefers resume over a new session id', () => {
    const args = buildClaudeArgs({ resume: 'old', sessionId: 'new' });
    expect(args).toContain('--resume');
    expect(args).not.toContain('--session-id');
  });
});

describe('buildClaudeArgs streaming', () => {
  it('asks for partial messages when streaming is wanted', () => {
    expect(buildClaudeArgs({ includePartialMessages: true })).toContain('--include-partial-messages');
    expect(buildClaudeArgs({})).not.toContain('--include-partial-messages');
  });
});

describe('buildClaudeArgs tools', () => {
  it('limits built-in tools with --tools, keeping both variadic flags last', () => {
    const args = buildClaudeArgs({ tools: ['Read', 'Grep'], allowedTools: ['mcp__agentoffice'] });
    expect(args.slice(-5)).toEqual(['--tools', 'Read', 'Grep', '--allowedTools', 'mcp__agentoffice']);
    expect(buildClaudeArgs({ tools: [] }).slice(-2)).toEqual(['--tools', '']);
  });
});

describe('userMessageLine', () => {
  it('encodes one stream-json user message per line', () => {
    expect(userMessageLine('hi\nthere')).toBe('{"type":"user","message":{"role":"user","content":"hi\\nthere"}}\n');
  });
});
