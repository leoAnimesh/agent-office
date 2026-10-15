import { describe, expect, it } from 'vitest';
import net from 'node:net';
import { allowedUrl, freePort, splitCommand, stripAnsi } from './rules';

describe('allowedUrl', () => {
  it('allows only http(s) on localhost, 127.0.0.1 and [::1]', () => {
    for (const ok of ['http://localhost:5173/', 'https://127.0.0.1/x?y=1', 'http://[::1]:3000/a']) expect(allowedUrl(ok)?.href, ok).toBeTruthy();
    for (const bad of ['https://example.com', 'http://localhost.evil.com', 'file:///etc/passwd', 'javascript:alert(1)', 'http://10.0.0.1', 'http://0.0.0.0:3000', 'not a url', 'ws://localhost:1'])
      expect(allowedUrl(bad), bad).toBeNull();
  });
});

describe('splitCommand', () => {
  it('splits on spaces, keeps quoted parts and fills in {port}', () => {
    expect(splitCommand('npm run dev', 5174)).toEqual(['npm', 'run', 'dev']);
    expect(splitCommand('npm run dev -- --port {port}', 5174)).toEqual(['npm', 'run', 'dev', '--', '--port', '5174']);
    expect(splitCommand(`node -e "console.log('a b')"`, 1)).toEqual(['node', '-e', "console.log('a b')"]);
    expect(splitCommand("echo 'x && y'", 1)).toEqual(['echo', 'x && y']);
  });

  it('refuses shell operators outside quotes, and empty commands', () => {
    for (const bad of ['npm i && npm run dev', 'a | b', 'a; b', 'a > f', 'a < f', 'echo `id`', 'echo $(id)', 'a || b'])
      expect(() => splitCommand(bad, 1), bad).toThrow(/package script/);
    expect(() => splitCommand('   ', 1)).toThrow(/command/);
    expect(() => splitCommand('echo "unterminated', 1)).toThrow(/quote/);
  });
});

describe('freePort', () => {
  it('returns a port that can be bound on 127.0.0.1', async () => {
    const port = await freePort();
    const srv = net.createServer();
    await new Promise<void>((resolve, reject) => { srv.once('error', reject); srv.listen(port, '127.0.0.1', () => resolve()); });
    srv.close();
  });
});

describe('stripAnsi', () => {
  it('removes colour codes', () => {
    expect(stripAnsi('\u001b[32mready\u001b[39m in 300 ms')).toBe('ready in 300 ms');
  });
});
