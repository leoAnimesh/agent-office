import type { OpenProjectStatus } from '../../../shared/types';

/** The sidebar note for a project: running in the background, how many are working, or that it needs you. */
export function projectStatus(s: OpenProjectStatus | undefined): { running: boolean; text: string; attention: boolean } {
  if (!s) return { running: false, text: '', attention: false };
  if (s.needsYou > 0) return { running: true, text: 'needs you', attention: true };
  return { running: true, text: s.working > 0 ? `${s.working} working` : 'running', attention: false };
}
