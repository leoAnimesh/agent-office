import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { ToolDef } from '../agents/bossTools';

const MAX_BODY = 1024 * 1024;

class HttpError extends Error {
  constructor(readonly status: number) { super(String(status)); }
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413);
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400);
  }
}

/** Read and discard the rest of a request body, giving up after a few seconds. */
function drain(req: http.IncomingMessage, ms = 5000): Promise<void> {
  if (req.readableEnded) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => { req.destroy(); resolve(); }, ms);
    const done = () => { clearTimeout(timer); resolve(); };
    req.once('end', done);
    req.once('error', done);
    req.resume();
  });
}

export class McpHost {
  readonly token = randomBytes(24).toString('hex');
  private server: http.Server | null = null;
  private port = 0;

  constructor(private readonly tools: ToolDef[], private readonly name = 'agentoffice') {}

  get url(): string {
    return `http://127.0.0.1:${this.port}/mcp`;
  }

  async start(): Promise<void> {
    const server = http.createServer((req, res) => { void this.handle(req, res); });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    this.port = (server.address() as AddressInfo).port;
    this.server = server;
  }

  mcpConfig(): { mcpServers: Record<string, { type: 'http'; url: string; headers: Record<string, string> }> } {
    return { mcpServers: { [this.name]: { type: 'http', url: this.url, headers: { Authorization: `Bearer ${this.token}` } } } };
  }

  async writeConfig(file: string): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    // mode 0o600 is ignored on Windows; the file lives in the user's private app-data folder and the token changes on every open.
    await fs.writeFile(file, JSON.stringify(this.mcpConfig(), null, 2), { mode: 0o600 });
    await fs.chmod(file, 0o600).catch(() => undefined);
  }

  async close(): Promise<void> {
    const s = this.server;
    this.server = null;
    if (!s) return;
    s.closeAllConnections();
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }

  private authorized(header: string | undefined): boolean {
    const expected = Buffer.from(`Bearer ${this.token}`);
    const got = Buffer.from(header ?? '');
    return got.length === expected.length && timingSafeEqual(got, expected);
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/mcp') throw new HttpError(404);
      if (!this.authorized(req.headers.authorization)) throw new HttpError(401);
      if (Number(req.headers['content-length'] ?? 0) > MAX_BODY) throw new HttpError(413);
      const body = await readJsonBody(req);
      const mcp = this.buildServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => { void transport.close(); void mcp.close(); });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      // Drain what the client is still sending so it receives the status instead of a connection reset.
      await drain(req);
      if (!res.headersSent) res.writeHead(err instanceof HttpError ? err.status : 500).end();
    }
  }

  private buildServer(): McpServer {
    const mcp = new McpServer({ name: this.name, version: '0.1.0' });
    for (const t of this.tools) {
      mcp.registerTool(t.name, { description: t.description, inputSchema: t.input }, async (args: unknown) => {
        try {
          const value = await t.run(args);
          return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
        } catch (err) {
          return { content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }], isError: true };
        }
      });
    }
    return mcp;
  }
}
