#!/usr/bin/env node
// A scripted stand-in for the `claude` CLI, controlled by FAKE_CLAUDE_* env vars.
import fs from 'node:fs';
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';

const argv = process.argv.slice(2);
const env = process.env;
if (env.FAKE_CLAUDE_ARGV_OUT) fs.appendFileSync(env.FAKE_CLAUDE_ARGV_OUT, JSON.stringify({ argv, cwd: process.cwd() }) + '\n');
if (argv.includes('--version')) {
  process.stdout.write('9.9.9 (Claude Code)\n');
  process.exit(0);
}

if (env.FAKE_CLAUDE_TRAP_TERM === '1') process.on('SIGTERM', () => { /* ignore, like a stuck tool */ });

if (env.FAKE_CLAUDE_RESUME_FAIL === '1' && argv.includes('--resume')) {
  process.stderr.write(`No conversation found with session ID: ${argv[argv.indexOf('--resume') + 1]}\n`);
  process.exit(1);
}

const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
// The boss is the one allowed to use the agentoffice MCP tools (employees may have their own MCP config).
const isBoss = argv.includes('mcp__agentoffice');
const sessionId = flag('--resume') ?? flag('--session-id') ?? randomUUID();
const fixture = env.FAKE_CLAUDE_FIXTURE ? fs.readFileSync(env.FAKE_CLAUDE_FIXTURE, 'utf8').split(/\r?\n/).filter(Boolean) : [];
const delay = Number(env.FAKE_CLAUDE_DELAY_MS ?? 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');

let turns = 0;
let queue = Promise.resolve();
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => { queue = queue.then(() => handle(line)); });
rl.on('close', () => { queue.then(() => process.exit(0)); });

async function handle(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.type !== 'user') return;
  const c = msg.message?.content;
  const content = typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => x.text ?? '').join('') : '';
  turns++;
  out({ type: 'system', subtype: 'init', session_id: sessionId, model: 'fake-model' });
  for (const l of fixture) {
    const o = JSON.parse(l);
    if (o.type === 'result' || (o.type === 'system' && o.subtype === 'init')) continue;
    o.session_id = sessionId;
    out(o);
    if (delay) await sleep(delay);
  }
  if (env.FAKE_CLAUDE_FILE && !isBoss) fs.appendFileSync(env.FAKE_CLAUDE_FILE, `turn ${turns}: ${content.split('\n')[0]}\n`);
  if (env.FAKE_CLAUDE_CRASH === '1') {
    process.stderr.write('boom: simulated crash\n');
    process.exit(3);
  }
  if (env.FAKE_CLAUDE_HANG === '1') return;
  const fail = env.FAKE_CLAUDE_FAIL === '1';
  const mcpText = env.FAKE_CLAUDE_MCP_CALLS && !isBoss && flag('--mcp-config') ? await mcpCalls().catch((e) => `mcp failed: ${e.message}`) : '';
  if (!fail && argv.includes('--include-partial-messages')) {
    // Like the real CLI: stream the reply in small pieces, then send the complete message.
    const reply = `echo: ${content.slice(0, 200)}`;
    for (let i = 0; i < reply.length; i += 6) {
      out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: reply.slice(i, i + 6) } }, session_id: sessionId });
      await sleep(2);
    }
    out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: reply }] }, session_id: sessionId });
  }
  out({
    type: 'result', subtype: fail ? 'error_during_execution' : 'success', is_error: fail,
    result: fail ? 'simulated failure' : (env.FAKE_CLAUDE_RESULT ?? (mcpText || `echo: ${content.slice(0, 200)}`)),
    session_id: sessionId, num_turns: turns, total_cost_usd: 0, duration_ms: 1,
  });
}

/** Calls the employee tools listed in FAKE_CLAUDE_MCP_CALLS; "$URL" in args becomes the last returned url. */
async function mcpCalls() {
  // Loaded only here: some tests copy this script to a folder where the SDK cannot be resolved.
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const cfg = JSON.parse(fs.readFileSync(flag('--mcp-config'), 'utf8'));
  const server = Object.values(cfg.mcpServers)[0];
  const client = new Client({ name: 'fake-claude', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers } }));
  const lines = [];
  let lastUrl = '';
  for (const c of JSON.parse(env.FAKE_CLAUDE_MCP_CALLS)) {
    const args = JSON.parse(JSON.stringify(c.args ?? {}).split('$URL').join(lastUrl));
    const r = await client.callTool({ name: c.tool, arguments: args });
    const text = (r.content ?? []).map((x) => x.text ?? `[${x.type}]`).join(' ');
    try { const v = JSON.parse(text); if (v && typeof v.url === 'string') lastUrl = v.url; } catch { /* not JSON */ }
    lines.push(`${c.tool}${r.isError ? ' (error)' : ''}: ${text.slice(0, 300)}`);
  }
  await client.close();
  return lines.join('\n');
}
