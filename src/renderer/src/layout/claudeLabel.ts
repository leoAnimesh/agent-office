/** How the project header names the coding agent: "Claude Code v2.1.299", with "· connected" for the tooltip. */
export function claudeLabel(claude: { path: string; version: string | null }): { text: string; title: string } {
  const text = claude.version ? `Claude Code v${claude.version}` : 'Claude Code';
  return { text, title: `${text} · connected` };
}
