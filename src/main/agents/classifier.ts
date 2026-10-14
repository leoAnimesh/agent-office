import { z } from 'zod';
import { AUTO_MODEL, type ModelPick, type TaskSize } from '../../shared/types';

export const SIZE_MODEL: Record<TaskSize, string> = { small: 'haiku', medium: 'sonnet', large: 'opus' };
export const FALLBACK_MODEL = 'sonnet';
export const CLASSIFIER_MODEL = 'opus';
const MAX_REASON = 200;

export interface ClassifyInput { title: string; brief: string; roleName: string }

const replySchema = z.object({ size: z.enum(['small', 'medium', 'large']), reason: z.string().trim().min(1) });

/** Pulls the first {...} block out of the reply (tolerates fences and prose) and validates it. */
export function parseClassification(text: string): { size: TaskSize; reason: string } | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let raw: unknown;
  try { raw = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  const r = replySchema.safeParse(raw);
  if (!r.success) return null;
  return { size: r.data.size, reason: Array.from(r.data.reason).slice(0, MAX_REASON).join('') };
}

export function classifierPrompt(i: ClassifyInput): string {
  return [
    'You size coding tasks so each one runs on the cheapest model that can do it well.',
    'Sizes:',
    '- small: one file or a few lines; typo, rename, config tweak, copy change, simple question.',
    '- medium: a contained feature or bug fix touching a few files, with tests.',
    '- large: cross-cutting work, a new subsystem, a multi-module refactor, tricky debugging, or a security-sensitive change.',
    '',
    `Role: ${i.roleName}`,
    `Title: ${i.title}`,
    'Brief:',
    i.brief,
    '',
    'Reply with only this JSON and nothing else: {"size": "small" | "medium" | "large", "reason": "<one short line>"}',
  ].join('\n');
}

export function fallbackPick(cause: string): ModelPick {
  return { model: FALLBACK_MODEL, reason: `Classifier unavailable: ${cause}`, source: 'fallback' };
}

/** The model to launch with: the task's pick, else the role's model, never 'auto'. */
export function launchModel(roleModel: string, taskModel?: string): string {
  if (taskModel) return taskModel;
  return roleModel === AUTO_MODEL ? FALLBACK_MODEL : roleModel;
}
