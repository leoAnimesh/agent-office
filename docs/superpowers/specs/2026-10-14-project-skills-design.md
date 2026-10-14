# Project Skills — Design Spec

Date: 2026-10-14
Status: Draft for review

## 1. Summary

Today each role carries a fixed list of skills from a 6-file library, and those skills are pasted into every employee's system prompt for that role. This feature grows the built-in library to about 22 skills and moves the choice from the role to the **project**: the boss reads the project and picks the skills it needs (`set_project_skills`), every employee on the project gets exactly that set, and the user can see and edit it in the Team view.

## 2. Goals and non-goals

**Goals**
- A built-in library broad enough for common stacks (frontend, backend, data, mobile, ops, quality).
- One skill set per project, chosen by the boss when a project is created or first opened after this change, and changeable later.
- Every employee on a project gets the project's skills, whatever their role.
- The user sees the set (with the boss's reasons) and can add or remove skills; the boss respects those choices.

**Non-goals**
- Using the user's installed Claude Code skills or plugins (employees stay isolated with `--setting-sources project,local`).
- Per-task skills.
- Loading skill text on demand (skills stay inlined in the system prompt).

## 3. Library (`resources/skills/`)

### 3.1 New files

Grow from 6 to these 22 (existing ids kept, their text unchanged unless noted):

| id | tags |
| --- | --- |
| `a11y-checklist` (existing) | frontend, accessibility |
| `react-patterns` (existing) | frontend, react |
| `nextjs` | frontend, react, nextjs, ssr |
| `vue` | frontend, vue |
| `css-tailwind` | frontend, css, tailwind |
| `typescript` | typescript, javascript |
| `api-design` (existing) | backend, api, http |
| `node-express` | backend, node, javascript |
| `python-backend` | backend, python, fastapi, django |
| `go-services` | backend, go |
| `sql-databases` | backend, database, sql, migrations |
| `auth-security` | backend, security, auth |
| `security-review` | security |
| `testing-basics` (existing) | testing |
| `e2e-playwright` | testing, e2e, playwright |
| `performance` | performance, frontend, backend |
| `docker` | ops, docker |
| `github-actions` | ops, ci |
| `react-native` | mobile, react-native |
| `python-data` | data, python, pandas |
| `docs-style` (existing) | docs |
| `git-hygiene` (existing) | git |

Each file: the existing frontmatter (`name`, `description`) plus a new `tags:` line (comma-separated), then 8–25 concise, imperative bullets of practical guidance. The six existing files only gain a `tags:` line.

### 3.2 Tags on `Skill`

- `Skill` gains `tags: string[]` (empty when the file has none).
- `parseSkill` reads `tags:` (comma-separated, trimmed, lower-cased, empties dropped, at most 10 tags of at most 30 chars).
- `SkillStore.save` writes `tags:` back when non-empty, so editing a skill in the app no longer drops it.
- `skillSchema` accepts `tags: z.array(z.string().trim().min(1).max(30)).max(10).optional()`.

### 3.3 Existing installs

`SkillStore.seed` already copies only missing files, so the 16 new skills appear on the next launch and user-edited files are never overwritten. The six existing files on disk keep no `tags:` line; that is fine (tags are a hint for the boss, not required).

## 4. Project skill set

### 4.1 Data (`src/shared/types.ts`)

```ts
export interface ProjectSkill { id: string; reason: string; addedBy: 'boss' | 'user' }
// Project gains:
skills?: ProjectSkill[];      // undefined = not chosen yet
skillsExcluded?: string[];    // ids the user removed; the boss cannot re-add them
```

Both optional: existing `project.json` files load unchanged and start in "not chosen yet".

`MAX_PROJECT_SKILLS = 12`.

### 4.2 Rules (`src/main/agents/projectSkills.ts`, pure)

- `applyBossPicks(current: Project, picks: {id, reason}[], known: Set<string>): { skills, kept, skipped }`
  - Unknown ids → throw `UserError` listing them (nothing changes).
  - Result = all current `addedBy: 'user'` entries (always kept) + boss picks, minus any id in `skillsExcluded` (reported in `skipped` with reason "removed by the user"), de-duplicated (a user entry wins over a boss pick of the same id).
  - If the result has more than `MAX_PROJECT_SKILLS` entries → throw `UserError` ("At most 12 skills per project; you picked N plus M added by the user").
  - Reasons are trimmed and clipped to 160 code points; an empty reason becomes "Picked by the boss".
- `applyUserEdit(current: Project, edit: { add?: string[]; remove?: string[] }, known: Set<string>): { skills, skillsExcluded }`
  - `add`: unknown ids → throw `UserError`; each added id becomes `{ id, reason: 'Added by you', addedBy: 'user' }` (replacing a boss entry of the same id) and is removed from `skillsExcluded`.
  - `remove`: drops the entry and adds the id to `skillsExcluded`.
  - Same 12 cap.
  - A user edit on a project with `skills === undefined` starts from `[]`.
- "Chosen" means `skills !== undefined`. Any user edit sets `skills` (possibly to `[]`), so afterwards the boss prompt shows the set instead of the "not chosen yet" instruction.

## 5. Boss tools (`bossTools.ts`)

- `list_skills()` → `[{ id, name, description, tags, in_project: boolean, added_by?: 'boss' | 'user', excluded: boolean }]` for the whole library.
- `set_project_skills({ skills: [{ id: string, reason: string }] })` (array 0–12) → runs `applyBossPicks`, saves the project, emits the workspace event `{ type: 'project' }`, returns `{ skills: [{id, reason, added_by}], kept_user_skills: string[], skipped: [{id, why}] , note: 'Employees get these from their next task.' }`.
- `assign_task`: unchanged behaviour; when `project.skills === undefined` its result gains `reminder: 'No project skills chosen yet; employees work without skills. Call list_skills and set_project_skills.'`.

## 6. Prompts (`prompt.ts`, `AgentManager`, `BossSession`)

- Employees: `AgentManager.writePrompt` loads `skills.getMany(projectSkillIds(project))` instead of `role.skills`. Prompts are already rewritten at every task start and follow-up, so a changed set applies from the next session start.
- Boss: keeps its own `role.skills`. `renderPrompt` for `kind: 'boss'` gains a `## Project skills` section built from a new `PromptContext.projectSkills?: { chosen: boolean; names: string[] }`:
  - chosen → "Employees on this project get these skills: A, B, C. Change them with `set_project_skills` when the work changes (the user may also edit them)."
  - not chosen → "No skills are chosen for this project yet. Before assigning the first task, look at the repo (README, package files, folder layout) and the user's brief, call `list_skills`, then `set_project_skills` with the skills employees need and a one-line reason each."
- The "How you work" list gains one bullet: "Pick project skills with `set_project_skills` before the first task (see Project skills)."
- `ProjectService` reads the project fresh when it builds the boss prompt (the boss session's prompt is written at each process start, including resumes).

## 7. User editing

### 7.1 IPC

- New channel `setProjectSkills(edit: { add?: string[]; remove?: string[] })` → `WorkspaceSnapshot`.
- Handler goes through the sender guard; arguments validated with a zod schema (`add`/`remove`: arrays of ≤ 22 skill ids matching the skill id pattern).
- `ProjectService.setProjectSkills` runs `applyUserEdit`, saves, emits `{ type: 'project' }`, and tells the boss through `BossSession.notify`: `[AgentOffice] The user changed the project skills: +docker −vue. Respect these; you cannot re-add skills the user removed.`.

### 7.2 Team view panel

- New component `ProjectSkillsPanel` above "On the team" in `TeamView`.
- Shows each project skill as a chip: name, and `by boss` / `by you`; the reason is the chip's `title`; an × button (`aria-label="Remove <name>"`) removes it.
- "Add skill" is a `<select>` labelled "Add skill" listing library skills not in the set (name — description), plus an "Add" button.
- When `skills === undefined`: a muted line "The boss hasn't picked skills for this project yet." (adding still works).
- Counter "N / 12". Errors (cap, unknown id) surface through the existing `onError` banner.
- Pure helpers in `src/renderer/src/team/projectSkills.ts` (rows for chips, options for the picker), unit-tested.

### 7.3 Role editor

- Remove the per-role skill checkboxes from `RoleEditor`; keep the library management ("Add skill file", editing skill text) in the Roles & skills view.
- Role files keep their `skills` arrays (the schema still accepts them); they no longer affect employees. The skill chips in `AgentDetailView` (currently `role.skills`) show the project's skills instead.

## 8. Error handling

| Case | Behaviour |
| --- | --- |
| Boss picks an unknown id | Tool error naming the ids; set unchanged. |
| Boss picks more than fits under the cap | Tool error with the counts; set unchanged. |
| Boss re-adds a user-removed skill | Skipped, reported in `skipped`; other picks applied. |
| A project skill file is deleted from the library | `getMany` already skips missing files; `list_skills` no longer lists it; the stale id stays in `project.skills` until the next edit, which drops unknown ids silently. |
| Corrupt or missing `project.json` fields | Treated as not chosen. |

## 9. Testing

- `projectSkills.test.ts` (pure): boss picks keep user entries, skip excluded ids, de-duplicate, enforce the cap, reject unknown ids, clip reasons; user add/remove updates `skillsExcluded`, replaces boss entries, enforces the cap, starts from `[]` when unchosen.
- `skillStore.test.ts`: `tags` parsed (case, spaces, empties, limits) and round-tripped by `save`.
- Library test: every file in `resources/skills/` parses with a name, description, ≥ 1 tag and a non-empty body; the 22 ids above exist.
- `bossTools.test.ts`: `list_skills` shape and flags; `set_project_skills` happy path, skipped/kept reporting, errors; `assign_task` reminder only while unchosen.
- `prompt.test.ts`: boss prompt has the not-chosen instruction, then the chosen list; employee prompt contains the passed skills.
- Manager integration: an employee's prompt file contains exactly the project's skills (not the role's) and picks up a change on the next task.
- `projectService` test: `setProjectSkills` edits, validates, emits `{ type: 'project' }`, and notifies the boss.
- Renderer helper tests for the panel.
- Gates: `npm run typecheck && npm test && npm run test:e2e`; screenshot the Team view with the fake CLI.
