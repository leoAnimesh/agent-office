/** IPC is only accepted from the app's own page: the packaged file, or the dev server in development. */
export function isTrustedSender(url: string | undefined, devUrl: string | undefined): boolean {
  if (!url) return false;
  if (url.startsWith('file://')) return true;
  return Boolean(devUrl) && url.startsWith(devUrl as string);
}
