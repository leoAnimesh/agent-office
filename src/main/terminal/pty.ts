import type { SpawnPty } from './terminalService';

/**
 * Loads the native PTY lazily: if the add-on is missing or broken on this machine, only the terminal is
 * unavailable and the rest of the app keeps working.
 */
export async function loadSpawnPty(): Promise<SpawnPty> {
  const pty = await import('@lydell/node-pty');
  return (file, args, opts) => pty.spawn(file, args, opts);
}
