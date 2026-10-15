# Project Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The boss picks the skills a project needs from a 22-skill library, every employee on the project gets exactly that set, and the user can see and edit it in the Team view.

**Architecture:** Skill choice moves from the role to the `Project` (`project.skills`, `project.skillsExcluded`). Pure rules in `src/main/agents/projectSkills.ts` decide what a boss pick or a user edit does. The boss gets `list_skills` / `set_project_skills`; the user edits through a new IPC call and a panel in the Team tab. `AgentManager.writePrompt` reads `project.skills` instead of `role.skills`. `ProjectService`, `AgentManager`, `BossSession` and `bossTools` all hold the **same** `Project` object, so changing it in place is seen by every one of them at its next prompt write.

**Tech Stack:** TypeScript, Electron, React, zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-14-project-skills-design.md`

**Spec drift since it was written (rulings, apply throughout):**
- The role editor and the Roles & skills view were removed (roles change only through the boss). Spec §7.3's "remove the per-role skill checkboxes" is already done; the only part left is the `AgentDetailView` chips.
- The Team tab is now a boss row plus a card grid. The skills panel goes between the boss row and the grid (spec said "above On the team").
- The `saveSkill` IPC is gone, but `SkillStore.save` still exists and still gets the `tags:` write-back (spec §3.2), so nothing that saves a skill drops tags.

## Global Constraints

- `MAX_PROJECT_SKILLS = 12`.
- Skill ids match `^[a-z0-9][a-z0-9-]{0,63}$` (the existing `id` in `store/validate.ts`).
- Tags: comma-separated, trimmed, lower-cased, empties dropped, at most 10 tags of at most 30 chars.
- Boss reasons are trimmed and clipped to 160 code points; an empty reason becomes `Picked by the boss`. User-added entries get reason `Added by you`.
- A user edit's `add`/`remove` arrays hold at most 22 ids each.
- Model and agent text is rendered only as React text. Every control is a real `<button>` / `<select>` with an accessible name. Use the colour variables from `tokens.css`.
- Gates: `npm run typecheck && npm test && npm run test:e2e`.
- Commits: Conventional Commits, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A project saved before this change (no `skills` key) must open, show "not picked yet", and give employees no skills, not crash. Pinned in Task 3 (manager test with `skills` undefined) and Task 6 (helpers with `skills` undefined).
2. A skill file deleted from the library while its id is still in `project.skills`: prompts skip it, the next boss pick or user edit drops it silently. Pinned in Task 2 (`drops stale ids`) and Task 3 (prompt test with a missing id).
3. The boss re-adding a skill the user removed must be skipped and reported, while its other picks still apply. Pinned in Task 2.
4. A user who adds a skill the boss had picked: the entry becomes `addedBy: 'user'` and a later boss pick without it keeps it. Pinned in Task 2.
5. The renderer sending junk to `setProjectSkills` (non-arrays, bad ids, 1000 ids) is refused before it touches the project. Pinned in Task 5.

---

### Task 1: Skill tags and the 22-skill library

**Files:**
- Modify: `src/shared/types.ts:19` (`Skill`)
- Modify: `src/main/store/skillStore.ts` (`parseSkill`, `save`)
- Modify: `src/main/store/validate.ts` (`skillSchema`)
- Modify: the 6 files in `resources/skills/` (add a `tags:` line)
- Create: 16 files in `resources/skills/` (contents below)
- Create: `src/main/store/skillStore.test.ts`
- Create: `test/skillLibrary.test.ts`

**Interfaces:**
- Produces: `Skill { id; name; description; body; tags: string[] }`; `parseSkill(id, raw): Skill` (fills `tags`); `parseTags(raw: string): string[]`.

- [ ] **Step 1: Write the failing tests**

`src/main/store/skillStore.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SkillStore, parseSkill, parseTags } from './skillStore';

describe('parseTags', () => {
  it('trims, lower-cases, drops empties and caps count and length', () => {
    expect(parseTags(' Frontend, React ,, CSS ')).toEqual(['frontend', 'react', 'css']);
    expect(parseTags('')).toEqual([]);
    expect(parseTags(Array.from({ length: 14 }, (_, i) => `t${i}`).join(','))).toHaveLength(10);
    expect(parseTags(`${'x'.repeat(40)}, ok`)).toEqual(['ok']);
  });
});

describe('parseSkill', () => {
  it('reads tags from the frontmatter, and gives [] without them', () => {
    expect(parseSkill('a', '---\nname: A\ndescription: d\ntags: Go, backend\n---\n- x').tags).toEqual(['go', 'backend']);
    expect(parseSkill('b', '---\nname: B\ndescription: d\n---\n- x').tags).toEqual([]);
    expect(parseSkill('c', 'no frontmatter').tags).toEqual([]);
  });
});

describe('SkillStore.save', () => {
  let dir: string;
  beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-skill-')); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); });

  it('writes tags back so a saved skill keeps them', async () => {
    const store = new SkillStore(dir);
    await store.save({ id: 'go-services', name: 'Go', description: 'd', body: '- x', tags: ['go', 'backend'] });
    expect((await store.get('go-services'))!.tags).toEqual(['go', 'backend']);
    await store.save({ id: 'plain', name: 'P', description: 'd', body: '- x', tags: [] });
    expect(await fs.readFile(path.join(dir, 'plain.md'), 'utf8')).not.toContain('tags:');
  });
});
```

`test/skillLibrary.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { SkillStore } from '../src/main/store/skillStore';

const IDS = [
  'a11y-checklist', 'react-patterns', 'nextjs', 'vue', 'css-tailwind', 'typescript', 'api-design', 'node-express',
  'python-backend', 'go-services', 'sql-databases', 'auth-security', 'security-review', 'testing-basics',
  'e2e-playwright', 'performance', 'docker', 'github-actions', 'react-native', 'python-data', 'docs-style', 'git-hygiene',
];

describe('built-in skill library', () => {
  it('has the 22 skills, each with a name, description, tags and guidance', async () => {
    const skills = await new SkillStore(path.resolve('resources/skills')).list();
    expect(skills.map((s) => s.id).sort()).toEqual([...IDS].sort());
    for (const s of skills) {
      expect(s.name, s.id).not.toBe(s.id);
      expect(s.description.length, s.id).toBeGreaterThan(0);
      expect(s.tags.length, s.id).toBeGreaterThan(0);
      expect(s.body.split('\n').filter((l) => l.startsWith('- ')).length, s.id).toBeGreaterThanOrEqual(4);
    }
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/main/store/skillStore.test.ts test/skillLibrary.test.ts`
Expected: FAIL — `parseTags` is not exported; the library has 6 skills and no tags.

- [ ] **Step 3: Implement tags**

`src/shared/types.ts`:

```ts
export interface Skill { id: string; name: string; description: string; body: string; tags: string[] }
```

`src/main/store/skillStore.ts` — add and use:

```ts
/** `tags:` frontmatter: a hint for the boss when it picks project skills. */
export function parseTags(raw: string): string[] {
  return raw.split(',').map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0 && t.length <= 30).slice(0, 10);
}
```

In `parseSkill`: the no-frontmatter return gains `tags: []`; the main return gains `tags: parseTags(meta.tags ?? '')`.

In `save`, write the tags line only when there are tags:

```ts
const tags = skill.tags.length > 0 ? `tags: ${skill.tags.join(', ')}\n` : '';
await fs.writeFile(path.join(this.dir, `${skill.id}.md`), `---\nname: ${skill.name.replace(/\n/g, ' ')}\ndescription: ${skill.description.replace(/\n/g, ' ')}\n${tags}---\n${skill.body.trim()}\n`);
```

`src/main/store/validate.ts` `skillSchema` gains `tags: z.array(z.string().trim().min(1).max(30)).max(10).optional(),`.

Fix any other `Skill` literal the typechecker flags (e.g. `src/main/agents/prompt.test.ts` gets `tags: []`).

- [ ] **Step 4: Tag the 6 existing skills**

Insert a `tags:` line after `description:` in each (bodies unchanged):

| file | line |
| --- | --- |
| `a11y-checklist.md` | `tags: frontend, accessibility` |
| `react-patterns.md` | `tags: frontend, react` |
| `api-design.md` | `tags: backend, api, http` |
| `testing-basics.md` | `tags: testing` |
| `docs-style.md` | `tags: docs` |
| `git-hygiene.md` | `tags: git` |

- [ ] **Step 5: Add the 16 new skills**

`resources/skills/nextjs.md`:
```md
---
name: Next.js
description: App Router, server components and data fetching
tags: frontend, react, nextjs, ssr
---
- Check whether the project uses the App Router (`app/`) or the Pages Router (`pages/`) and stay with it.
- Components are server components by default; add `"use client"` only to components that need state, effects or browser APIs.
- Fetch data in server components or route handlers, not in `useEffect`.
- Keep secrets on the server: only `NEXT_PUBLIC_` variables reach the browser.
- Use `next/link` for internal links and `next/image` for images with known sizes.
- Put shared layout in `layout.tsx`; use `loading.tsx` and `error.tsx` for loading and error states.
- Mutations go through server actions or route handlers; revalidate with `revalidatePath`/`revalidateTag` afterwards.
- Run `next build` before you finish: it catches server/client boundary errors that the dev server misses.
```

`resources/skills/vue.md`:
```md
---
name: Vue
description: Vue 3 components and state
tags: frontend, vue
---
- Match the project's style: Composition API with `<script setup>` unless the code uses the Options API.
- Declare props with `defineProps` and types; emit events with `defineEmits`; never mutate a prop.
- Use `computed` for derived values and `watch` only for side effects.
- Keep shared state in the project's store (Pinia or the existing one), not in ad-hoc globals.
- Give every `v-for` a stable `:key`; never use `v-if` and `v-for` on the same element.
- Use scoped styles or the project's CSS approach; do not add global CSS for one component.
- Test components with the project's runner (Vitest + Vue Test Utils if present).
```

`resources/skills/css-tailwind.md`:
```md
---
name: CSS and Tailwind
description: Styling, layout and responsive design
tags: frontend, css, tailwind
---
- Use the project's existing approach (Tailwind, CSS modules, plain CSS) and its design tokens; never hard-code colours that already have a token.
- With Tailwind, compose utilities in markup; extract a component, not an `@apply` class, when a pattern repeats.
- Lay out with flexbox and grid; avoid absolute positioning for layout.
- Design mobile first and check widths of 320px, 768px and 1280px.
- Give flex children `min-width: 0` so long text cannot overflow.
- Keep text contrast at least 4.5:1 and visible focus styles on every interactive element.
- Respect `prefers-reduced-motion` for animations.
```

`resources/skills/typescript.md`:
```md
---
name: TypeScript
description: Types that catch mistakes
tags: typescript, javascript
---
- Keep `strict` on. Do not add `any`; use `unknown` and narrow it.
- Type function inputs and exported return values; let local values infer.
- Model states with discriminated unions instead of optional flags.
- Validate data from outside (HTTP, files, user input) at the boundary, e.g. with zod, then trust the types inside.
- Avoid non-null `!` and `as` casts; when one is needed, leave a short comment why.
- Prefer `readonly` arrays and objects for values that should not change.
- Run the project's typecheck (`tsc --noEmit` or its npm script) before you finish.
```

`resources/skills/node-express.md`:
```md
---
name: Node and Express
description: Node.js HTTP services
tags: backend, node, javascript
---
- Use `async` handlers and pass errors to one error middleware; never leave a promise unhandled.
- Validate every request body, query and param before use.
- Keep route handlers thin: put logic in plain functions you can test without HTTP.
- Read configuration from environment variables with defaults checked at startup; never commit secrets.
- Return consistent JSON errors with the right status codes (400, 401, 403, 404, 409, 500).
- Do not block the event loop: no sync file or crypto calls in request paths.
- Test routes with the project's tool (supertest or similar) against an in-memory or test database.
```

`resources/skills/python-backend.md`:
```md
---
name: Python backend
description: FastAPI, Django and Flask services
tags: backend, python, fastapi, django
---
- Use the project's framework, layout and dependency tool (pip, poetry, uv); add dependencies through it.
- Type-hint functions; with FastAPI, define request and response models with Pydantic.
- Keep views or routes thin and put logic in services you can test directly.
- Use the ORM's migrations for every schema change (Alembic, Django migrations).
- Never build SQL with string formatting; use parameters or the ORM.
- Read settings from the environment; never commit secrets.
- Run the tests with the project's command (usually `pytest`) and the linter it uses (ruff, flake8).
```

`resources/skills/go-services.md`:
```md
---
name: Go services
description: Idiomatic Go for services and tools
tags: backend, go
---
- Run `gofmt` (or `goimports`) on every file you touch.
- Return errors, wrap them with context (`fmt.Errorf("load user: %w", err)`), and handle each one.
- Pass `context.Context` as the first argument through request paths and respect cancellation.
- Keep interfaces small and define them where they are used.
- Avoid package-level mutable state; inject dependencies.
- Guard shared data with a mutex or channels, and run `go test -race` on concurrent code.
- Write table-driven tests and run `go vet ./...` and `go test ./...` before you finish.
```

`resources/skills/sql-databases.md`:
```md
---
name: SQL and databases
description: Schemas, queries and migrations
tags: backend, database, sql, migrations
---
- Change the schema only through a new migration; never edit a migration that has already run.
- Make migrations safe to run on live data: add columns nullable or with defaults, backfill, then tighten.
- Always use parameterized queries.
- Add indexes for columns used in frequent `WHERE`, `JOIN` and `ORDER BY` clauses; check plans with `EXPLAIN`.
- Wrap multi-step writes in a transaction.
- Avoid N+1 queries: load related rows in one query or a batched one.
- Use the right types (timestamps with time zone, numeric for money) and constraints (NOT NULL, foreign keys, unique).
```

`resources/skills/auth-security.md`:
```md
---
name: Auth and security
description: Authentication, sessions and access control
tags: backend, security, auth
---
- Never write your own crypto or password hashing; use the framework's or bcrypt/argon2.
- Check authorization on the server for every request that reads or changes data, not only in the UI.
- Store sessions in HttpOnly, Secure, SameSite cookies, or short-lived tokens; never put tokens in URLs.
- Protect state-changing requests against CSRF when cookies authenticate them.
- Rate-limit login, sign-up and password reset.
- Do not reveal whether an account exists in login or reset errors.
- Keep secrets in environment variables or a secret store; never log them.
```

`resources/skills/security-review.md`:
```md
---
name: Security review
description: Spot common vulnerabilities before they ship
tags: security
---
- Treat all input as untrusted: validate type, length and format at the boundary.
- Look for injection: SQL, shell commands, HTML (XSS), file paths (`../`), and template strings.
- Do not pass user input to a shell; use argument arrays.
- Escape output for its context; never insert raw HTML from users.
- Check that every endpoint enforces who may call it.
- Check new dependencies: maintained, widely used, pinned in the lockfile.
- Report anything risky you find in your summary even if it is outside your task.
```

`resources/skills/e2e-playwright.md`:
```md
---
name: End-to-end tests with Playwright
description: Reliable browser tests
tags: testing, e2e, playwright
---
- Find elements by role, label or text (`getByRole`, `getByLabel`), not by CSS classes.
- Use web-first assertions (`await expect(locator).toBeVisible()`); never use fixed sleeps.
- Keep each test independent: set up its own data and do not depend on test order.
- Test the user's path, not implementation details.
- Run headless in CI; use `--headed` or the trace viewer only for debugging.
- When a test is flaky, find the race instead of adding retries.
```

`resources/skills/performance.md`:
```md
---
name: Performance
description: Measure, then make it faster
tags: performance, frontend, backend
---
- Measure before and after any optimisation, and report both numbers.
- Frontend: keep bundles small (lazy-load routes and heavy libraries), size images, avoid layout shifts.
- React: avoid needless re-renders; memoise only where a profile shows it helps.
- Backend: find slow queries first; add indexes, batch work, and paginate large results.
- Cache only with a clear invalidation rule.
- Do not trade correctness or readability for a gain you have not measured.
```

`resources/skills/docker.md`:
```md
---
name: Docker
description: Images and compose files
tags: ops, docker
---
- Pin base image versions; prefer slim or distroless images.
- Order Dockerfile steps so dependency installs are cached: copy lockfiles, install, then copy source.
- Use multi-stage builds so build tools stay out of the final image.
- Run as a non-root user.
- Keep a `.dockerignore` that excludes `node_modules`, `.git`, build output and secrets.
- Pass configuration through environment variables; never bake secrets into images.
- Add health checks for long-running services.
```

`resources/skills/github-actions.md`:
```md
---
name: GitHub Actions
description: CI workflows
tags: ops, ci
---
- Pin third-party actions to a version tag or commit SHA.
- Give workflows the least `permissions` they need.
- Cache dependencies with the setup action's cache option.
- Run the same commands CI runs locally before you push a workflow change.
- Use a matrix for several OS or language versions instead of copying jobs.
- Never print secrets; pass them through `secrets.*` and environment variables.
```

`resources/skills/react-native.md`:
```md
---
name: React Native
description: Mobile apps with React Native and Expo
tags: mobile, react-native
---
- Check whether the project uses Expo or bare React Native and use its tools to add native modules.
- Use `FlatList`/`SectionList` for long lists, never a mapped `ScrollView`.
- Style with `StyleSheet.create` or the project's styling library; test on small and large screens.
- Handle safe areas, the keyboard, and both iOS and Android back behaviour.
- Give touchable elements an `accessibilityLabel` and a target of at least 44×44 points.
- Keep secrets off the device; the app bundle is readable.
```

`resources/skills/python-data.md`:
```md
---
name: Python data work
description: pandas, notebooks and data pipelines
tags: data, python, pandas
---
- Load data with explicit dtypes and parse dates on read.
- Prefer vectorised pandas or NumPy operations to Python loops.
- Never change the raw input data; write results to new files or tables.
- Check shapes, null counts and value ranges after each step that changes them.
- Put reusable logic in `.py` modules, not only in notebooks, and test it.
- Pin library versions in the project's requirements file.
- Make runs reproducible: fixed random seeds and documented input files.
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/main/store/skillStore.test.ts test/skillLibrary.test.ts && npm run typecheck`
Expected: PASS, 0 type errors.

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/main/store resources/skills test/skillLibrary.test.ts src/main/agents/prompt.test.ts
git commit -m "feat(skills): tags on skills and a 22-skill built-in library"
```

---

### Task 2: Project skill rules (pure)

**Files:**
- Modify: `src/shared/types.ts` (`ProjectSkill`, `Project`, `MAX_PROJECT_SKILLS`)
- Create: `src/main/agents/projectSkills.ts`
- Create: `src/main/agents/projectSkills.test.ts`

**Interfaces:**
- Consumes: `UserError` from `src/main/agents/agentManager.ts`.
- Produces:
  - `interface ProjectSkill { id: string; reason: string; addedBy: 'boss' | 'user' }`
  - `Project.skills?: ProjectSkill[]`, `Project.skillsExcluded?: string[]`
  - `const MAX_PROJECT_SKILLS = 12`
  - `applyBossPicks(current: Project, picks: { id: string; reason: string }[], known: Set<string>): { skills: ProjectSkill[]; kept: string[]; skipped: { id: string; why: string }[] }`
  - `applyUserEdit(current: Project, edit: { add?: string[]; remove?: string[] }, known: Set<string>): { skills: ProjectSkill[]; skillsExcluded: string[] }`
  - `projectSkillIds(p: Project): string[]`

- [ ] **Step 1: Write the failing test**

`src/main/agents/projectSkills.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Project } from '../../shared/types';
import { applyBossPicks, applyUserEdit, projectSkillIds } from './projectSkills';

const base: Project = { id: 'p', name: 'p', repoPath: '/r', baseBranch: 'main', maxConcurrent: 4, autoMerge: false };
const known = new Set(Array.from({ length: 22 }, (_, i) => `s${i}`).concat(['docker', 'vue', 'react-patterns']));
const pick = (id: string, reason = 'why') => ({ id, reason });

describe('applyBossPicks', () => {
  it('sets the boss picks on an unchosen project', () => {
    const r = applyBossPicks(base, [pick('docker', ' containers '), pick('vue', '')], known);
    expect(r.skills).toEqual([
      { id: 'docker', reason: 'containers', addedBy: 'boss' },
      { id: 'vue', reason: 'Picked by the boss', addedBy: 'boss' },
    ]);
    expect(r).toMatchObject({ kept: [], skipped: [] });
  });

  it('keeps user entries, skips ids the user removed, and de-duplicates', () => {
    const p: Project = { ...base, skills: [{ id: 'vue', reason: 'Added by you', addedBy: 'user' }, { id: 's1', reason: 'old', addedBy: 'boss' }], skillsExcluded: ['docker'] };
    const r = applyBossPicks(p, [pick('docker'), pick('vue', 'boss says'), pick('s2'), pick('s2', 'twice')], known);
    expect(r.skills).toEqual([
      { id: 'vue', reason: 'Added by you', addedBy: 'user' },
      { id: 's2', reason: 'why', addedBy: 'boss' },
    ]);
    expect(r.kept).toEqual(['vue']);
    expect(r.skipped).toEqual([{ id: 'docker', why: 'removed by the user' }]);
  });

  it('rejects unknown ids and changes nothing', () => {
    expect(() => applyBossPicks(base, [pick('docker'), pick('nope'), pick('also-no')], known)).toThrow(/Unknown skills: nope, also-no/);
  });

  it('enforces the cap counting user entries', () => {
    const p: Project = { ...base, skills: [{ id: 's0', reason: 'x', addedBy: 'user' }, { id: 's1', reason: 'x', addedBy: 'user' }] };
    const picks = Array.from({ length: 11 }, (_, i) => pick(`s${i + 2}`));
    expect(() => applyBossPicks(p, picks, known)).toThrow('At most 12 skills per project; you picked 11 plus 2 added by the user');
    expect(applyBossPicks(p, picks.slice(0, 10), known).skills).toHaveLength(12);
  });

  it('clips long reasons to 160 code points', () => {
    const r = applyBossPicks(base, [pick('docker', '🙂'.repeat(200))], known);
    expect([...r.skills[0].reason]).toHaveLength(160);
  });

  it('drops stale user ids that are no longer in the library', () => {
    const p: Project = { ...base, skills: [{ id: 'gone', reason: 'x', addedBy: 'user' }] };
    expect(applyBossPicks(p, [pick('docker')], known).skills.map((s) => s.id)).toEqual(['docker']);
  });
});

describe('applyUserEdit', () => {
  it('starts from [] when unchosen; add marks user entries and clears exclusions', () => {
    const r = applyUserEdit({ ...base, skillsExcluded: ['docker'] }, { add: ['docker'] }, known);
    expect(r).toEqual({ skills: [{ id: 'docker', reason: 'Added by you', addedBy: 'user' }], skillsExcluded: [] });
    expect(applyUserEdit(base, {}, known)).toEqual({ skills: [], skillsExcluded: [] });
  });

  it('replaces a boss entry with a user entry when the user adds it', () => {
    const p: Project = { ...base, skills: [{ id: 'vue', reason: 'boss', addedBy: 'boss' }] };
    expect(applyUserEdit(p, { add: ['vue'] }, known).skills).toEqual([{ id: 'vue', reason: 'Added by you', addedBy: 'user' }]);
  });

  it('remove drops the entry and excludes the id once', () => {
    const p: Project = { ...base, skills: [{ id: 'vue', reason: 'boss', addedBy: 'boss' }], skillsExcluded: ['vue'] };
    expect(applyUserEdit(p, { remove: ['vue'] }, known)).toEqual({ skills: [], skillsExcluded: ['vue'] });
  });

  it('rejects unknown adds and enforces the cap', () => {
    expect(() => applyUserEdit(base, { add: ['nope'] }, known)).toThrow(/Unknown skills: nope/);
    const full: Project = { ...base, skills: Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, reason: 'x', addedBy: 'boss' as const })) };
    expect(() => applyUserEdit(full, { add: ['docker'] }, known)).toThrow(/At most 12 skills per project/);
    expect(applyUserEdit(full, { add: ['docker'], remove: ['s0'] }, known).skills).toHaveLength(12);
  });
});

describe('projectSkillIds', () => {
  it('lists ids, or none when unchosen', () => {
    expect(projectSkillIds(base)).toEqual([]);
    expect(projectSkillIds({ ...base, skills: [{ id: 'vue', reason: 'x', addedBy: 'user' }] })).toEqual(['vue']);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/main/agents/projectSkills.test.ts`
Expected: FAIL — cannot resolve `./projectSkills`.

- [ ] **Step 3: Implement**

`src/shared/types.ts` — after `Skill`:

```ts
/** A skill every employee on the project gets. The user's own choices win over the boss's. */
export interface ProjectSkill { id: string; reason: string; addedBy: 'boss' | 'user' }
export const MAX_PROJECT_SKILLS = 12;
```

and `Project` gains:

```ts
  /** Skills every employee on the project gets; undefined until the boss or the user first picks. */
  skills?: ProjectSkill[];
  /** Skills the user removed; the boss cannot add them back. */
  skillsExcluded?: string[];
```

`src/main/agents/projectSkills.ts`:

```ts
import { MAX_PROJECT_SKILLS, type Project, type ProjectSkill } from '../../shared/types';
import { UserError } from './agentManager';

const clip = (s: string, n: number) => [...s].slice(0, n).join('');

function mustKnow(ids: string[], known: Set<string>): void {
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length > 0) throw new UserError(`Unknown skills: ${unknown.join(', ')}. Call list_skills for the ids.`);
}

export function projectSkillIds(p: Project): string[] {
  return (p.skills ?? []).map((s) => s.id);
}

/** The boss's picks replace its own earlier picks; the user's additions and removals always stand. */
export function applyBossPicks(current: Project, picks: { id: string; reason: string }[], known: Set<string>) {
  mustKnow(picks.map((p) => p.id), known);
  const user = (current.skills ?? []).filter((s) => s.addedBy === 'user' && known.has(s.id));
  const excluded = new Set(current.skillsExcluded ?? []);
  const taken = new Set(user.map((s) => s.id));
  const skipped: { id: string; why: string }[] = [];
  const boss: ProjectSkill[] = [];
  for (const p of picks) {
    if (excluded.has(p.id)) { if (!skipped.some((s) => s.id === p.id)) skipped.push({ id: p.id, why: 'removed by the user' }); continue; }
    if (taken.has(p.id)) continue;
    taken.add(p.id);
    boss.push({ id: p.id, reason: clip(p.reason.trim(), 160) || 'Picked by the boss', addedBy: 'boss' });
  }
  if (user.length + boss.length > MAX_PROJECT_SKILLS) {
    throw new UserError(`At most ${MAX_PROJECT_SKILLS} skills per project; you picked ${boss.length} plus ${user.length} added by the user`);
  }
  const kept = user.map((s) => s.id);
  return { skills: [...user, ...boss], kept, skipped };
}

export function applyUserEdit(current: Project, edit: { add?: string[]; remove?: string[] }, known: Set<string>) {
  const add = [...new Set(edit.add ?? [])];
  const remove = new Set(edit.remove ?? []);
  mustKnow(add, known);
  let skills = (current.skills ?? []).filter((s) => known.has(s.id) && !remove.has(s.id) && !add.includes(s.id));
  skills = [...skills, ...add.filter((id) => !remove.has(id)).map((id) => ({ id, reason: 'Added by you', addedBy: 'user' as const }))];
  if (skills.length > MAX_PROJECT_SKILLS) throw new UserError(`At most ${MAX_PROJECT_SKILLS} skills per project; remove one first`);
  const skillsExcluded = [...new Set([...(current.skillsExcluded ?? []).filter((id) => !add.includes(id)), ...remove])];
  return { skills, skillsExcluded };
}
```

- [ ] **Step 4: Run it**

Run: `npx vitest run src/main/agents/projectSkills.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/main/agents/projectSkills.ts src/main/agents/projectSkills.test.ts
git commit -m "feat(skills): rules for a project's skill set (boss picks, user edits, cap of 12)"
```

---

### Task 3: Prompts use the project's skills

**Files:**
- Modify: `src/main/agents/prompt.ts` (`PromptContext.projectSkills`, boss section, "How you work" bullet)
- Modify: `src/main/agents/prompt.test.ts`
- Modify: `src/main/agents/agentManager.ts:466-475` (`writePrompt`)
- Modify: `src/main/boss/bossSession.ts:128-133` (`ensureRunner`)
- Modify: `test/agentManager.test.ts` (new test)

**Interfaces:**
- Consumes: `projectSkillIds(p)` (Task 2), `SkillStore.getMany` / `list`.
- Produces: `PromptContext.projectSkills?: { chosen: boolean; names: string[] }`.

- [ ] **Step 1: Write the failing tests**

Append to `src/main/agents/prompt.test.ts`:

```ts
describe('renderPrompt (boss project skills)', () => {
  const boss = { ...role, name: 'Boss', systemPrompt: 'Lead.' };
  const ctx = { agentName: 'Max', bossName: 'Max', branch: 'main', projectName: 'demo', kind: 'boss' as const };

  it('asks the boss to pick skills while none are chosen', () => {
    const out = renderPrompt(boss, [], { ...ctx, projectSkills: { chosen: false, names: [] } });
    expect(out).toContain('## Project skills');
    expect(out).toContain('No skills are chosen for this project yet.');
    expect(out).toContain('`list_skills`');
    expect(out).toContain('Pick project skills with `set_project_skills` before the first task');
  });

  it('lists the chosen skills', () => {
    const out = renderPrompt(boss, [], { ...ctx, projectSkills: { chosen: true, names: ['Docker', 'Vue'] } });
    expect(out).toContain('Employees on this project get these skills: Docker, Vue.');
    expect(out).not.toContain('No skills are chosen');
  });

  it('says so when the chosen set is empty', () => {
    expect(renderPrompt(boss, [], { ...ctx, projectSkills: { chosen: true, names: [] } })).toContain('Employees on this project get no skills.');
  });
});
```

Append to `test/agentManager.test.ts` (inside its top-level `describe`, using the file's existing `h`/`make` setup — mirror how neighbouring tests create a manager, hire `Pixel` on `frontend`, and wait with `finished`):

```ts
it('gives employees the project skills, not the role skills, and picks up changes on the next task', async () => {
  const { manager, project } = await h.make();
  await manager.hire('frontend');
  const promptOf = async () => fs.readFile(path.join(h.paths.promptDir, `${manager.findAgent('Pixel')!.id}.md`), 'utf8');

  let done = finished(manager, 'T-101');
  await manager.createTask({ assignee: 'Pixel', title: 'a', brief: 'a', createdBy: 'user' });
  await done;
  expect(await promptOf()).not.toContain('## Skills'); // unchosen: none, even though the role lists four

  project.skills = [{ id: 'docker', reason: 'x', addedBy: 'boss' }, { id: 'missing-skill', reason: 'x', addedBy: 'user' }];
  done = finished(manager, 'T-102');
  await manager.createTask({ assignee: 'Pixel', title: 'b', brief: 'b', createdBy: 'user' });
  await done;
  const text = await promptOf();
  expect(text).toContain('### Docker');
  expect(text).not.toContain('### React patterns');
});
```

(If `test/agentManager.test.ts` builds its manager with its own helper rather than `harness()`, put this test in `test/bossTools.test.ts` instead, which uses `harness()`; the body is the same.)

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/main/agents/prompt.test.ts test/agentManager.test.ts`
Expected: FAIL — no `## Project skills` section; the prompt still contains `### React patterns`.

- [ ] **Step 3: Implement**

`src/main/agents/prompt.ts`:

```ts
export interface PromptContext {
  agentName: string;
  bossName: string;
  branch: string;
  projectName: string;
  kind: 'boss' | 'employee';
  /** Boss only: the project's skill set, or that it is not chosen yet. */
  projectSkills?: { chosen: boolean; names: string[] };
}
```

In the boss "How you work" list, add after the `list_team` bullet:

```ts
        '- Pick project skills with `set_project_skills` before the first task (see Project skills).',
```

After that `parts.push(...)` for the boss, add:

```ts
  if (ctx.kind === 'boss' && ctx.projectSkills) {
    const ps = ctx.projectSkills;
    parts.push(['## Project skills', ps.chosen
      ? `${ps.names.length > 0 ? `Employees on this project get these skills: ${ps.names.join(', ')}.` : 'Employees on this project get no skills.'} Change them with \`set_project_skills\` when the work changes (the user may also edit them).`
      : 'No skills are chosen for this project yet. Before assigning the first task, look at the repo (README, package files, folder layout) and the user\'s brief, call `list_skills`, then `set_project_skills` with the skills employees need and a one-line reason each.',
    ].join('\n'));
  }
```

`src/main/agents/agentManager.ts` `writePrompt`: import `projectSkillIds` from `./projectSkills` and replace `role.skills`:

```ts
    // Employees get the project's skills (picked by the boss and the user), whatever their role.
    const skills = await this.d.skills.getMany(projectSkillIds(this.d.project));
```

`src/main/boss/bossSession.ts` `ensureRunner`: keep `role.skills` for the boss's own skills, and pass the project set:

```ts
    const chosen = await this.d.skills.getMany((this.d.project.skills ?? []).map((s) => s.id));
    await fs.writeFile(promptFile, renderPrompt(role, skills, {
      agentName: boss.name, bossName: boss.name, branch: this.d.project.baseBranch, projectName: this.d.project.name, kind: 'boss',
      projectSkills: { chosen: this.d.project.skills !== undefined, names: chosen.map((s) => s.name) },
    }));
```

- [ ] **Step 4: Run them**

Run: `npx vitest run src/main/agents/prompt.test.ts test/agentManager.test.ts test/bossSession.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/agents/prompt.ts src/main/agents/prompt.test.ts src/main/agents/agentManager.ts src/main/boss/bossSession.ts test/agentManager.test.ts
git commit -m "feat(skills): employees get the project's skills; the boss is told to pick them"
```

---

### Task 4: Boss tools `list_skills` and `set_project_skills`

**Files:**
- Modify: `src/main/agents/bossTools.ts` (deps, two tools, `assign_task` reminder)
- Modify: `src/main/workspace/projectService.ts:182-188` (wire `skills` and `saveProject`)
- Modify: `test/bossTools.test.ts`

**Interfaces:**
- Consumes: `applyBossPicks`, `MAX_PROJECT_SKILLS` (Task 2); `SkillStore.list()`; `Skill.tags` (Task 1).
- Produces: `BossToolDeps.skills: SkillStore`, `BossToolDeps.saveProject(): Promise<void>` (persist `d.project` and emit `{ type: 'project' }`).

- [ ] **Step 1: Write the failing tests**

In `test/bossTools.test.ts`, change `setup` so the tools share the manager's project object and get the new deps:

```ts
async function setup(over: Partial<Project> = {}) {
  const env = await h.make();
  const project = Object.assign(env.project, over);
  const requestMerge = vi.fn(async () => ({ status: 'awaiting_user_approval' }));
  const report = vi.fn();
  const rolesChanged = vi.fn();
  const saveProject = vi.fn(async () => undefined);
  const tools = bossTools({ manager: env.manager, roles: env.roles, skills: env.skills, project, requestMerge, report, rolesChanged, saveProject });
  return { ...env, project, tools, requestMerge, report, rolesChanged, saveProject };
}
```

Add `'list_skills', 'set_project_skills'` to the sorted list in `exposes the documented tool set`, and add:

```ts
describe('project skills tools', () => {
  it('lists the library with project flags', async () => {
    const { tools } = await setup({ skills: [{ id: 'docker', reason: 'x', addedBy: 'user' }], skillsExcluded: ['vue'] });
    const list = (await call(tools, 'list_skills')) as Record<string, unknown>[];
    expect(list).toHaveLength(22);
    expect(list.find((s) => s.id === 'docker')).toMatchObject({ name: 'Docker', in_project: true, added_by: 'user', excluded: false, tags: ['ops', 'docker'] });
    expect(list.find((s) => s.id === 'vue')).toMatchObject({ in_project: false, excluded: true });
    expect(list.find((s) => s.id === 'vue')).not.toHaveProperty('added_by');
  });

  it('sets the project skills, keeps user ones, reports skips, and saves', async () => {
    const { tools, project, saveProject } = await setup({ skills: [{ id: 'docker', reason: 'mine', addedBy: 'user' }], skillsExcluded: ['vue'] });
    const r = await call(tools, 'set_project_skills', { skills: [{ id: 'typescript', reason: 'TS repo' }, { id: 'vue', reason: 'x' }] });
    expect(r).toEqual({
      skills: [{ id: 'docker', reason: 'mine', added_by: 'user' }, { id: 'typescript', reason: 'TS repo', added_by: 'boss' }],
      kept_user_skills: ['docker'],
      skipped: [{ id: 'vue', why: 'removed by the user' }],
      note: 'Employees get these from their next task.',
    });
    expect(project.skills!.map((s) => s.id)).toEqual(['docker', 'typescript']);
    expect(saveProject).toHaveBeenCalledOnce();
  });

  it('refuses unknown ids and too many, leaving the set unchanged', async () => {
    const { tools, project, saveProject } = await setup();
    await expect(call(tools, 'set_project_skills', { skills: [{ id: 'nope', reason: 'x' }] })).rejects.toThrow(/Unknown skills: nope/);
    await expect(call(tools, 'set_project_skills', { skills: Array.from({ length: 13 }, () => ({ id: 'docker', reason: 'x' })) })).rejects.toThrow();
    expect(project.skills).toBeUndefined();
    expect(saveProject).not.toHaveBeenCalled();
  });

  it('reminds the boss on assign_task only while skills are unchosen', async () => {
    const { tools, project } = await setup();
    await call(tools, 'hire', { role_id: 'frontend' });
    expect(await call(tools, 'assign_task', { agent: 'Pixel', title: 'a', brief: 'a' })).toMatchObject({ reminder: expect.stringContaining('set_project_skills') });
    project.skills = [];
    expect(await call(tools, 'assign_task', { agent: 'Pixel', title: 'b', brief: 'b' })).not.toHaveProperty('reminder');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run test/bossTools.test.ts`
Expected: FAIL — unknown tools `list_skills` / `set_project_skills`; no `reminder`.

- [ ] **Step 3: Implement**

`src/main/agents/bossTools.ts`:
- imports: `import type { SkillStore } from '../store/skillStore';`, `import { MAX_PROJECT_SKILLS } from '../../shared/types';` (alongside the existing type import), `import { applyBossPicks } from './projectSkills';`.
- `BossToolDeps` gains:

```ts
  skills: SkillStore;
  /** Persist `project` and tell the app it changed. */
  saveProject(): Promise<void>;
```

- In `assign_task`, return the reminder while unchosen:

```ts
        return {
          task_id: now.id, branch: now.branch, status: now.status,
          ...(d.project.skills === undefined ? { reminder: 'No project skills chosen yet; employees work without skills. Call list_skills and set_project_skills.' } : {}),
        };
```

- Add after `assign_task`:

```ts
    tool('list_skills', 'List the skill library: what each skill covers, and whether it is in this project, added by the user, or removed by the user (you cannot add those back).', {}, async () => {
      const inProject = new Map((d.project.skills ?? []).map((s) => [s.id, s.addedBy]));
      const excluded = new Set(d.project.skillsExcluded ?? []);
      return (await d.skills.list()).map((s) => ({
        id: s.id, name: s.name, description: s.description, tags: s.tags,
        in_project: inProject.has(s.id), ...(inProject.has(s.id) ? { added_by: inProject.get(s.id) } : {}), excluded: excluded.has(s.id),
      }));
    }),

    tool(
      'set_project_skills',
      `Choose the skills every employee on this project gets (at most ${MAX_PROJECT_SKILLS}, including ones the user added). Replaces your earlier picks; skills the user added stay, skills the user removed are skipped. Give a one-line reason for each.`,
      { skills: z.array(z.object({ id: z.string(), reason: z.string() })).max(MAX_PROJECT_SKILLS) },
      async ({ skills }) => {
        const known = new Set((await d.skills.list()).map((s) => s.id));
        const r = applyBossPicks(d.project, skills, known);
        d.project.skills = r.skills;
        await d.saveProject();
        return {
          skills: r.skills.map((s) => ({ id: s.id, reason: s.reason, added_by: s.addedBy })),
          kept_user_skills: r.kept, skipped: r.skipped, note: 'Employees get these from their next task.',
        };
      },
    ),
```

`src/main/workspace/projectService.ts` `open()` — the `bossTools({...})` call gains:

```ts
      skills: this.skills,
      saveProject: async () => { await this.store.saveProject(project); this.emitWs(ws, { type: 'project', project: { ...project } }); },
```

- [ ] **Step 4: Run them**

Run: `npx vitest run test/bossTools.test.ts test/projectService.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/agents/bossTools.ts src/main/workspace/projectService.ts test/bossTools.test.ts
git commit -m "feat(skills): boss tools list_skills and set_project_skills"
```

---

### Task 5: User edits over IPC

**Files:**
- Modify: `src/main/store/validate.ts` (`projectSkillsEditSchema`)
- Modify: `src/main/workspace/projectService.ts` (`setProjectSkills`)
- Modify: `src/shared/ipc.ts` (channel + API)
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts` (handler)
- Modify: `test/projectService.ui.test.ts`

**Interfaces:**
- Consumes: `applyUserEdit` (Task 2).
- Produces: `IPC.setProjectSkills = 'project:skills'`; `AgentOfficeApi.setProjectSkills(edit: { add?: string[]; remove?: string[] }): Promise<WorkspaceSnapshot>`; `ProjectService.setProjectSkills(edit: unknown): Promise<WorkspaceSnapshot>`.

- [ ] **Step 1: Write the failing test**

Append to `test/projectService.ui.test.ts` (it already opens a project with the fake CLI in its `beforeEach`; follow its existing pattern for `svc`, `events` and the open call):

```ts
it('lets the user add and remove project skills, and tells the boss', async () => {
  const notify = vi.spyOn(BossSession.prototype, 'notify').mockResolvedValue(undefined);
  const snap = await svc.setProjectSkills({ add: ['docker', 'vue'] });
  expect(snap.project.skills).toEqual([
    { id: 'docker', reason: 'Added by you', addedBy: 'user' },
    { id: 'vue', reason: 'Added by you', addedBy: 'user' },
  ]);
  const after = await svc.setProjectSkills({ remove: ['vue'] });
  expect(after.project).toMatchObject({ skillsExcluded: ['vue'] });
  expect(events.some((e) => e.type === 'project' && e.project.skills?.length === 1)).toBe(true);
  expect(notify).toHaveBeenLastCalledWith('The user changed the project skills: −vue. Respect these; you cannot re-add skills the user removed.');
  notify.mockRestore();
});

it('refuses bad project skill edits before changing anything', async () => {
  await expect(svc.setProjectSkills({ add: 'docker' })).rejects.toThrow();
  await expect(svc.setProjectSkills({ add: ['../etc'] })).rejects.toThrow();
  await expect(svc.setProjectSkills({ add: Array.from({ length: 23 }, (_, i) => `s${i}`) })).rejects.toThrow();
  await expect(svc.setProjectSkills({ add: ['no-such-skill'] })).rejects.toThrow(/Unknown skills/);
  expect((await svc.snapshot()).project.skills).toBeUndefined();
});
```

Add imports as needed: `vi` from vitest, `BossSession` from `../src/main/boss/bossSession`.

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run test/projectService.ui.test.ts`
Expected: FAIL — `svc.setProjectSkills is not a function`.

- [ ] **Step 3: Implement**

`src/main/store/validate.ts`:

```ts
export const projectSkillsEditSchema = z.object({
  add: z.array(id).max(22).optional(),
  remove: z.array(id).max(22).optional(),
}).strict();
```

`src/main/workspace/projectService.ts` (import `applyUserEdit` and `projectSkillsEditSchema`):

```ts
  /** The user's edit to the project's skills; the boss is told and cannot undo the removals. */
  async setProjectSkills(edit: unknown): Promise<WorkspaceSnapshot> {
    const ws = this.mustWs();
    const clean = parseOrThrow(projectSkillsEditSchema, edit, 'project skills');
    const known = new Set((await this.skills.list()).map((s) => s.id));
    const next = applyUserEdit(ws.project, clean, known);
    Object.assign(ws.project, next);
    await this.store.saveProject(ws.project);
    this.emitWs(ws, { type: 'project', project: { ...ws.project } });
    const change = [...(clean.add ?? []).map((id) => `+${id}`), ...(clean.remove ?? []).map((id) => `−${id}`)].join(' ');
    if (change) void ws.boss.notify(`The user changed the project skills: ${change}. Respect these; you cannot re-add skills the user removed.`).catch(() => undefined);
    return this.snapshot();
  }
```

`src/shared/ipc.ts`: add `setProjectSkills: 'project:skills',` to `IPC` and `setProjectSkills(edit: { add?: string[]; remove?: string[] }): Promise<WorkspaceSnapshot>;` to `AgentOfficeApi`.

`src/preload/index.ts`: `setProjectSkills: (edit) => ipcRenderer.invoke(IPC.setProjectSkills, edit),`

`src/main/index.ts`, next to `updateProject`: `handle(IPC.setProjectSkills, (edit: unknown) => svc.setProjectSkills(edit));`

- [ ] **Step 4: Run it**

Run: `npx vitest run test/projectService.ui.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/store/validate.ts src/main/workspace/projectService.ts src/shared/ipc.ts src/preload/index.ts src/main/index.ts test/projectService.ui.test.ts
git commit -m "feat(skills): the user can add and remove project skills"
```

---

### Task 6: Project skills panel in the Team tab

**Files:**
- Create: `src/renderer/src/team/projectSkills.ts`
- Create: `src/renderer/src/team/projectSkills.test.ts`
- Create: `src/renderer/src/components/ProjectSkillsPanel.tsx`
- Modify: `src/renderer/src/components/TeamView.tsx` (render the panel between the boss row and the grid)
- Modify: `src/renderer/src/components/AgentDetailView.tsx:50` (chips show project skills)
- Modify: `src/renderer/src/styles/app.css` (panel styles)
- Modify: `e2e/smoke.spec.ts` (first test, Team tab section)
- Modify: `AGENTS.md` (architecture line + known gaps)

**Interfaces:**
- Consumes: `Project.skills`, `MAX_PROJECT_SKILLS`, `window.agentOffice.listSkills()`, `window.agentOffice.setProjectSkills(edit)`.
- Produces: `skillChips(p: Project, lib: Skill[]): { id: string; name: string; by: 'boss' | 'you'; reason: string }[]`; `addableSkills(p: Project, lib: Skill[]): { id: string; label: string }[]`.

- [ ] **Step 1: Write the failing test**

`src/renderer/src/team/projectSkills.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Project, Skill } from '../../../shared/types';
import { addableSkills, skillChips } from './projectSkills';

const p: Project = { id: 'p', name: 'p', repoPath: '/r', baseBranch: 'main', maxConcurrent: 4, autoMerge: false };
const sk = (id: string, name: string): Skill => ({ id, name, description: `${name} tips`, body: '- x', tags: [] });
const lib = [sk('vue', 'Vue'), sk('docker', 'Docker'), sk('a11y', 'Accessibility')];

describe('skillChips', () => {
  it('shows names and who added each, skipping ids missing from the library', () => {
    const chips = skillChips({ ...p, skills: [{ id: 'vue', reason: 'r', addedBy: 'boss' }, { id: 'gone', reason: 'r', addedBy: 'user' }, { id: 'docker', reason: 'Added by you', addedBy: 'user' }] }, lib);
    expect(chips).toEqual([{ id: 'vue', name: 'Vue', by: 'boss', reason: 'r' }, { id: 'docker', name: 'Docker', by: 'you', reason: 'Added by you' }]);
    expect(skillChips(p, lib)).toEqual([]);
  });
});

describe('addableSkills', () => {
  it('lists library skills not in the set, by name', () => {
    expect(addableSkills({ ...p, skills: [{ id: 'vue', reason: 'r', addedBy: 'boss' }] }, lib)).toEqual([
      { id: 'a11y', label: 'Accessibility — Accessibility tips' },
      { id: 'docker', label: 'Docker — Docker tips' },
    ]);
    expect(addableSkills(p, lib)).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/renderer/src/team/projectSkills.test.ts`
Expected: FAIL — cannot resolve `./projectSkills`.

- [ ] **Step 3: Implement helpers, panel and wiring**

`src/renderer/src/team/projectSkills.ts`:

```ts
import type { Project, Skill } from '../../../shared/types';

/** Chips for the project's skills; ids no longer in the library are left out. */
export function skillChips(p: Project, lib: Skill[]): { id: string; name: string; by: 'boss' | 'you'; reason: string }[] {
  const byId = new Map(lib.map((s) => [s.id, s]));
  return (p.skills ?? []).flatMap((s) => {
    const skill = byId.get(s.id);
    return skill ? [{ id: s.id, name: skill.name, by: s.addedBy === 'user' ? 'you' as const : 'boss' as const, reason: s.reason }] : [];
  });
}

/** Library skills the user can still add, by name. */
export function addableSkills(p: Project, lib: Skill[]): { id: string; label: string }[] {
  const taken = new Set((p.skills ?? []).map((s) => s.id));
  return lib.filter((s) => !taken.has(s.id)).sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => ({ id: s.id, label: s.description ? `${s.name} — ${s.description}` : s.name }));
}
```

`src/renderer/src/components/ProjectSkillsPanel.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { MAX_PROJECT_SKILLS, type Project, type Skill } from '../../../shared/types';
import { addableSkills, skillChips } from '../team/projectSkills';

interface Props { project: Project; onError: (m: string) => void }

/** The skills every employee on this project gets. The boss picks them; the user can add and remove. */
export function ProjectSkillsPanel({ project, onError }: Props) {
  const [lib, setLib] = useState<Skill[]>([]);
  const [pick, setPick] = useState('');
  useEffect(() => { window.agentOffice.listSkills().then(setLib, (e) => onError(String(e))); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const chips = skillChips(project, lib);
  const options = addableSkills(project, lib);
  const edit = async (e: { add?: string[]; remove?: string[] }) => {
    try { await window.agentOffice.setProjectSkills(e); setPick(''); } catch (err) { onError(String(err)); }
  };

  return (
    <section className="skills-panel" aria-label="Project skills">
      <div className="skills-head">
        <h3>Project skills</h3>
        <span className="small muted mono">{chips.length} / {MAX_PROJECT_SKILLS}</span>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        {project.skills === undefined ? "The boss hasn't picked skills for this project yet." : 'Every employee on this project gets these.'}
      </p>
      {chips.length > 0 && (
        <ul className="skill-chips">
          {chips.map((c) => (
            <li key={c.id} className="skill-chip" title={c.reason}>
              <span>{c.name}</span>
              <span className="small muted">by {c.by}</span>
              <button type="button" className="skill-remove" aria-label={`Remove ${c.name}`} onClick={() => void edit({ remove: [c.id] })}>×</button>
            </li>
          ))}
        </ul>
      )}
      <div className="row skills-add">
        <label htmlFor="skill-add" className="small muted">Add skill</label>
        <select id="skill-add" className="input" value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">Choose a skill…</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <button type="button" className="btn small" disabled={!pick} onClick={() => void edit({ add: [pick] })}>Add</button>
      </div>
    </section>
  );
}
```

`TeamView.tsx`: import `ProjectSkillsPanel`; in the returned JSX, right after `{boss && bossRow(boss)}`, add `<ProjectSkillsPanel project={ws.project} onError={onError} />`.

`AgentDetailView.tsx` line 50: show the project's skills instead of the role's (the agent detail does not have the library, so show ids):

```tsx
          {!isBoss && (ws.project.skills ?? []).length > 0 && <div className="row" aria-label="Project skills">{ws.project.skills!.map((s) => <span key={s.id} className="chip" title={s.reason}>{s.id}</span>)}</div>}
```

`app.css` (after the `.boss-card` rules):

```css
.skills-panel { display: flex; flex-direction: column; gap: 8px; padding: 12px 16px; background: var(--panel-2); border: 1px solid #33374a; border-radius: 10px; }
.skills-head { display: flex; align-items: baseline; gap: 10px; }
.skills-head h3 { margin: 0; font-size: 14px; }
.skill-chips { display: flex; flex-wrap: wrap; gap: 6px; list-style: none; margin: 0; padding: 0; }
.skill-chip { display: inline-flex; align-items: center; gap: 6px; padding: 2px 4px 2px 10px; border: 1px solid #3a3f55; border-radius: 999px; min-width: 0; }
.skill-remove { background: none; border: 0; color: var(--muted); font-size: 16px; line-height: 1; padding: 2px 6px; border-radius: 999px; cursor: pointer; }
.skill-remove:hover, .skill-remove:focus-visible { color: var(--text); background: var(--panel); }
.skills-add { flex-wrap: wrap; gap: 8px; }
.skills-add select { min-width: 0; flex: 1 1 220px; max-width: 420px; }
```

(Check `tokens.css` for the exact variable names of panel, muted and text colours and use those; the border hex matches the existing `.boss-card` rule.)

- [ ] **Step 4: Run the helper test**

Run: `npx vitest run src/renderer/src/team/projectSkills.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Extend the e2e smoke test**

In `e2e/smoke.spec.ts`, first test, right after `await expect(win.getByText('ask the boss in the chat')).toBeVisible();`:

```ts
    const skills = win.getByRole('region', { name: 'Project skills' });
    await expect(skills.getByText("The boss hasn't picked skills for this project yet.")).toBeVisible();
    await skills.getByLabel('Add skill').selectOption('docker');
    await skills.getByRole('button', { name: 'Add' }).click();
    await expect(skills.getByText('Every employee on this project gets these.')).toBeVisible();
    await expect(skills.getByText('1 / 12')).toBeVisible();
    await skills.getByRole('button', { name: 'Remove Docker' }).click();
    await expect(skills.getByText('0 / 12')).toBeVisible();
```

- [ ] **Step 6: Update AGENTS.md**

- In the Architecture tree, `agents/` line: add `projectSkills (the project's skill set: boss picks, user edits)` after `prompt (role prompt + skills)`, and change `prompt (role prompt + skills)` to `prompt (role prompt + project skills)`.
- In Security rules, the roles bullet: append "Project skills are picked by the boss (`set_project_skills`) from the built-in library; the user's additions and removals in the Team tab always win."
- In Known gaps, replace "the app cannot change a role's skills (roles made in chat start with none)" with "role skill lists no longer do anything (employees get the project's skills)".

- [ ] **Step 7: Run every gate**

Run: `npm run typecheck && npm test && npm run test:e2e`
Expected: 0 type errors; all unit tests pass; 7 e2e tests pass.

Then screenshot the Team tab with the fake CLI (scratchpad `shot.mjs` pattern: temp repo, temp `AO_USER_DATA`) and look at the panel at 1280px and 800px widths.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/team/projectSkills.ts src/renderer/src/team/projectSkills.test.ts src/renderer/src/components/ProjectSkillsPanel.tsx src/renderer/src/components/TeamView.tsx src/renderer/src/components/AgentDetailView.tsx src/renderer/src/styles/app.css e2e/smoke.spec.ts AGENTS.md
git commit -m "feat(skills): project skills panel in the Team tab"
```
