import http from 'node:http';
if (process.argv.includes('--fork-and-exit')) {
  // Like a launcher (npm) that starts the real server and goes away: the child keeps the port.
  const { spawn } = await import('node:child_process');
  spawn(process.execPath, [process.argv[1], ...process.argv.slice(2).filter((a) => a !== '--fork-and-exit')], { stdio: 'ignore' });
  process.exit(0);
}
if (process.argv.includes('--die')) { console.error('boom: cannot start'); process.exit(2); }
const port = process.argv.includes('--ignore-port') ? 0 : Number(process.env.PORT);
const portArg = process.argv.indexOf('--port');
const p = portArg > 0 ? Number(process.argv[portArg + 1]) : port;
http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end('<!doctype html><title>Fixture app</title><h1>Hello</h1><button onclick="document.querySelector(\'h1\').textContent=\'Clicked\'">Press me</button><input aria-label="Name"><script>console.error("fixture warning")</script>');
}).listen(p, '127.0.0.1', () => console.log(`\u001b[32mready\u001b[39m on ${p}`));
