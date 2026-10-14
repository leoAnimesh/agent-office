import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpHost } from '../src/main/mcp/mcpHost';
import type { ToolDef } from '../src/main/agents/bossTools';

const tools: ToolDef[] = [
  { name: 'echo', description: 'Echo the text back', input: { text: z.string() }, run: async (a) => ({ said: (a as { text: string }).text }) },
  { name: 'boom', description: 'Always fails loudly', input: {}, run: async () => { throw new Error('nope, not allowed'); } },
];

let host: McpHost;
beforeEach(async () => { host = new McpHost(tools); await host.start(); });
afterEach(async () => { await host.close(); });

async function connect(token = host.token): Promise<Client> {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(host.url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return client;
}

describe('McpHost', () => {
  it('listens on loopback only', () => {
    expect(host.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  });

  it('lists and calls tools for an authorized client', async () => {
    const client = await connect();
    const list = await client.listTools();
    expect(list.tools.map((t) => t.name).sort()).toEqual(['boom', 'echo']);
    const r = await client.callTool({ name: 'echo', arguments: { text: 'hi' } });
    expect(r.isError).toBeFalsy();
    expect(JSON.parse((r.content as { text: string }[])[0].text)).toEqual({ said: 'hi' });
    await client.close();
  });

  it('turns thrown errors into tool errors the model can read', async () => {
    const client = await connect();
    const r = await client.callTool({ name: 'boom', arguments: {} });
    expect(r.isError).toBe(true);
    expect((r.content as { text: string }[])[0].text).toContain('nope, not allowed');
    await client.close();
  });

  it('rejects missing or wrong tokens, wrong paths, bad JSON and huge bodies', async () => {
    const post = (url: string, headers: Record<string, string>, body: string) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body });
    const ok = { authorization: `Bearer ${host.token}` };
    expect((await post(host.url, {}, '{}')).status).toBe(401);
    expect((await post(host.url, { authorization: 'Bearer wrong' }, '{}')).status).toBe(401);
    expect((await post(host.url.replace('/mcp', '/other'), ok, '{}')).status).toBe(404);
    expect((await post(host.url, ok, '{not json')).status).toBe(400);
    expect((await post(host.url, ok, 'x'.repeat(2 * 1024 * 1024))).status).toBe(413);
    await expect(connect('wrong')).rejects.toThrow();
  });

  it('writes a private claude --mcp-config file', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-mcp-'));
    const file = path.join(dir, 'mcp.json');
    await host.writeConfig(file);
    const cfg = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(cfg).toEqual({ mcpServers: { agentoffice: { type: 'http', url: host.url, headers: { Authorization: `Bearer ${host.token}` } } } });
    if (process.platform !== 'win32') expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
});
