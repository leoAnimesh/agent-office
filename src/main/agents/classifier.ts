import { z } from 'zod';
import { AUTO_MODEL, type ModelPick, type RunnerEvent, type TaskSize } from '../../shared/types';
import { waitForExit, type AgentRunner, type ClaudeRunnerOptions } from '../claude/runner';

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

/** Aborting the signal stops the CLI process and resolves with a fallback. */
export type TaskClassifier = (input: ClassifyInput, signal?: AbortSignal) => Promise<ModelPick>;

export interface ClassifierDeps {
  createRunner: (o: ClaudeRunnerOptions) => AgentRunner;
  claudeBin: string;
  /** Working folder for the one-shot session. Not the user's repo: the classifier needs no files. */
  cwd: string;
  isolateUserSettings: boolean;
  timeoutMs?: number;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** One-shot Opus call per task. Never rejects: any failure becomes a sonnet fallback. */
export function createClassifier(d: ClassifierDeps): TaskClassifier {
  return async (input, signal) => {
    let runner: AgentRunner;
    try {
      runner = d.createRunner({
        bin: d.claudeBin, cwd: d.cwd,
        launch: { model: CLASSIFIER_MODEL, tools: [], isolateUserSettings: d.isolateUserSettings },
      });
    } catch (e) {
      return fallbackPick(errText(e));
    }
    const outcome = await new Promise<{ text: string } | { cause: string }>((resolve) => {
      let settled = false;
      const finish = (r: { text: string } | { cause: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        runner.off('event', listener);
        resolve(r);
      };
      const listener = (ev: RunnerEvent) => {
        if (ev.type === 'result') finish(ev.ok ? { text: ev.text } : { cause: 'error result' });
        else if (ev.type === 'exit') finish({ cause: `exited (${ev.code ?? ev.signal ?? 'unknown'})` });
      };
      const timer = setTimeout(() => finish({ cause: 'timed out' }), d.timeoutMs ?? 60_000);
      const onAbort = () => finish({ cause: 'cancelled' });
      if (signal?.aborted) return finish({ cause: 'cancelled' });
      signal?.addEventListener('abort', onAbort, { once: true });
      runner.on('event', listener);
      try {
        runner.start();
        if (runner.running) runner.send(classifierPrompt(input));
      } catch (e) {
        finish({ cause: errText(e) });
      }
    });
    if (runner.running) {
      const exited = waitForExit(runner, 5000);
      runner.endInput();
      runner.stop();
      await exited;
    }
    if ('cause' in outcome) return fallbackPick(outcome.cause);
    const parsed = parseClassification(outcome.text);
    if (!parsed) return fallbackPick('unreadable reply');
    return { model: SIZE_MODEL[parsed.size], size: parsed.size, reason: parsed.reason, source: 'classifier' };
  };
}
