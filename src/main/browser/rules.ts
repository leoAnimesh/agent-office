import net from 'node:net';

export const LOCAL_ONLY = 'Only local addresses (localhost / 127.0.0.1) can be opened';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Employees may only open their own local app: http(s) on the loopback names, nothing else. */
export function allowedUrl(raw: string): URL | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return LOCAL_HOSTS.has(u.hostname) ? u : null;
}

/**
 * Splits a dev server command into argv without a shell. Quotes group words; shell operators outside quotes are
 * refused, because there is no shell to run them. `{port}` becomes the chosen port.
 */
export function splitCommand(command: string, port: number): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let started = false;
  const s = command.trim();
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null; else cur += c;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; started = true; continue; }
    if (/\s/.test(c)) { if (started) { out.push(cur); cur = ''; started = false; } continue; }
    if ('|;<>`&'.includes(c) || (c === '$' && s[i + 1] === '(')) {
      throw new Error('Shell operators are not supported here. Use a package script for compound commands (e.g. npm run dev).');
    }
    cur += c; started = true;
  }
  if (quote) throw new Error('The command has an unclosed quote');
  if (started) out.push(cur);
  if (out.length === 0) throw new Error('Give the command that starts the dev server, e.g. npm run dev');
  return out.map((a) => a.split('{port}').join(String(port)));
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

// eslint-disable-next-line no-control-regex
export const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
