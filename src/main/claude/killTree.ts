import { spawn } from 'node:child_process';

/** Kill a process and its children. POSIX children must be spawned with `detached: true`. */
export function killTree(pid: number, platform: NodeJS.Platform = process.platform): void {
  if (platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {});
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
  }
}
