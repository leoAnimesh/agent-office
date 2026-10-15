import { z } from 'zod';

const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'must be a #RRGGBB colour');
const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'use lowercase letters, digits and dashes');

export const roleSchema = z.object({
  id,
  name: z.string().trim().min(1).max(60),
  blurb: z.string().max(120),
  systemPrompt: z.string().max(20_000),
  skills: z.array(id).max(50),
  model: z.string().trim().min(1).max(80),
  permissionMode: z.enum(['acceptEdits', 'default', 'plan', 'bypassPermissions']),
  allowedTools: z.array(z.string().trim().min(1).max(200)).min(1).max(100),
  look: z.object({ hair: hex, shirt: hex, skin: hex }),
}).strict();

export const skillSchema = z.object({
  id,
  name: z.string().trim().min(1).max(80),
  description: z.string().max(200),
  body: z.string().min(1).max(50_000),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
}).strict();

export const projectSkillsEditSchema = z.object({
  add: z.array(id).max(22).optional(),
  remove: z.array(id).max(22).optional(),
}).strict();

export const projectPatchSchema = z.object({
  maxConcurrent: z.number().int().min(1).max(8).optional(),
  autoMerge: z.boolean().optional(),
}).strict();

export const settingsSchema = z.object({
  claudePath: z.string().trim().min(1).max(1000).nullable().optional(),
  isolateUserSettings: z.boolean().optional(),
  autoModelMigrated: z.boolean().optional(),
  allToolsMigrated: z.boolean().optional(),
}).strict();

export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  const first = r.error.issues[0];
  const where = first?.path.length ? first.path.join('.') : 'value';
  throw new Error(`Invalid ${what}: ${where} ${first?.message ?? 'is not valid'}`);
}
