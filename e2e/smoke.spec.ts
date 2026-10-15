import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeRepo } from '../test/helpers/repo';
import { addFixtureServer } from '../test/fixtures/browser-repo';

const FAKE = path.resolve('test/fake-claude/fake-claude.mjs');

async function launch(env: Record<string, string>, reuse?: string): Promise<{ app: ElectronApplication; userData: string }> {
  const userData = reuse ?? (await fs.mkdtemp(path.join(os.tmpdir(), 'ao-e2e-')));
  const base = { ...process.env } as Record<string, string>;
  delete base.ELECTRON_RENDERER_URL;
  const args = process.platform === 'linux' ? ['--no-sandbox', path.resolve('.')] : [path.resolve('.')];
  const app = await electron.launch({ args, env: { ...base, AO_USER_DATA: userData, ...env } });
  return { app, userData };
}

/** Hiring goes through the boss chat, which the fake CLI cannot do: add employees to the saved team instead. */
async function seedTeam(userData: string, people: { name: string; roleId: string }[]): Promise<string> {
  const pdir = path.join(userData, 'projects', (await fs.readdir(path.join(userData, 'projects')))[0]);
  const file = path.join(pdir, 'agents.json');
  const agents = JSON.parse(await fs.readFile(file, 'utf8')) as unknown[];
  people.forEach((p, i) => agents.push({ id: `seed-${i}`, projectId: path.basename(pdir), name: p.name, roleId: p.roleId, kind: 'employee', status: 'idle', bubble: 'Idle' }));
  await fs.writeFile(file, JSON.stringify(agents));
  return pdir;
}

/** Relaunch on the same app data and get back into the project. */
async function reopen(env: Record<string, string>, userData: string): Promise<{ app: ElectronApplication; win: Page }> {
  const { app } = await launch(env, userData);
  const win = await app.firstWindow();
  const browse = win.getByRole('button', { name: 'Browse' });
  await expect(browse.or(win.getByRole('button', { name: /^Max, Boss/ }))).toBeVisible();
  if (await browse.isVisible()) {
    await browse.click();
    await win.getByRole('button', { name: /Open the office/ }).click();
  }
  return { app, win };
}

test('first launch → open a repo → chat with the boss → team → see the desk', async () => {
  const repo = await makeRepo();
  const env = { AO_CLAUDE_BIN: process.execPath, AO_CLAUDE_ARGS: JSON.stringify([FAKE]), AO_E2E_PICK_FOLDER: repo };
  let { app, userData } = await launch(env);
  try {
    let win = await app.firstWindow();
    await expect(win.getByRole('heading', { name: 'Welcome to AgentOffice' })).toBeVisible();
    await win.getByRole('button', { name: 'Browse' }).click();
    await win.getByRole('button', { name: /Open the office/ }).click();
    await expect(win.getByRole('button', { name: /^Max, Boss/ })).toBeVisible();

    const box = win.getByLabel('Message the boss');
    await box.fill('Hello <b>team</b> 🤖 '.repeat(3).trim());
    await box.press('Enter');
    await expect(win.getByText(/^echo: Hello <b>team<\/b> 🤖/)).toBeVisible();

    await box.fill('**bold** words\n- one\n- two');
    await box.press('Enter');
    const reply = win.locator('.msg.boss', { hasText: 'bold words' });
    await expect(reply.locator('strong', { hasText: 'bold' })).toBeVisible();
    await expect(reply.locator('li')).toHaveCount(2);

    await app.close();
    await seedTeam(userData, [{ name: 'Pixel', roleId: 'frontend' }]);
    ({ app, win } = await reopen(env, userData));
    await win.getByRole('navigation', { name: 'Project views' }).getByRole('button', { name: 'Team' }).click();
    await expect(win.getByRole('region', { name: 'Role library' })).toHaveCount(0);
    await expect(win.getByText('ask the boss in the chat')).toBeVisible();
    const skills = win.getByRole('region', { name: 'Project skills' });
    await expect(skills.getByText("The boss hasn't picked skills for this project yet.")).toBeVisible();
    await skills.getByLabel('Add skill').selectOption('docker');
    await skills.getByRole('button', { name: 'Add' }).click();
    await expect(skills.getByText('Every employee on this project gets these.')).toBeVisible();
    await expect(skills.getByText('1 / 12')).toBeVisible();
    await skills.getByRole('button', { name: 'Remove Docker' }).click();
    await expect(skills.getByText('0 / 12')).toBeVisible();

    // Each team member's actions sit behind a ⋯ menu.
    const options = win.getByRole('button', { name: 'Options for Pixel' });
    await options.click();
    const menu = win.getByRole('menu', { name: 'Options for Pixel' });
    await expect(menu.getByRole('menuitem')).toHaveText(['Open details', 'Fire…']);
    await expect(menu.getByRole('menuitem', { name: 'Open details' })).toBeFocused();
    await win.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: 'Fire…' })).toBeFocused();
    await win.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(options).toBeFocused();
    await options.click();
    await menu.getByRole('menuitem', { name: 'Fire…' }).click();
    await win.getByRole('button', { name: 'Keep' }).click();
    await win.getByRole('button', { name: 'Options for Max' }).click();
    await expect(win.getByRole('menu', { name: 'Options for Max' }).getByRole('menuitem')).toHaveText(['Open details']);
    await win.keyboard.press('Escape');

    await win.getByRole('navigation', { name: 'Project views' }).getByRole('button', { name: 'Office' }).click();
    await expect(win.getByRole('button', { name: /^Pixel, Frontend Engineer/ })).toBeVisible();
  } finally {
    await app.close();
    await fs.rm(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    await fs.rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('marks new messages that arrive while you are scrolled up', async () => {
  const repo = await makeRepo();
  const { app, userData } = await launch({ AO_CLAUDE_BIN: process.execPath, AO_CLAUDE_ARGS: JSON.stringify([FAKE]), AO_E2E_PICK_FOLDER: repo });
  try {
    const win = await app.firstWindow();
    await win.setViewportSize({ width: 1400, height: 760 });
    await win.getByRole('button', { name: 'Browse' }).click();
    await win.getByRole('button', { name: /Open the office/ }).click();
    await expect(win.getByRole('button', { name: /^Max, Boss/ })).toBeVisible();
    const log = win.getByRole('log', { name: 'Conversation with the boss' });
    for (let i = 1; i <= 6; i++) {
      await win.evaluate((t) => window.agentOffice.sendToBoss(t), `filler message number ${i} with enough words to take some space in the chat`);
      // A finished reply: not the live, still-typing bubble.
      await expect(log.locator('.msg.boss:not(.streaming)', { hasText: `number ${i} ` })).toBeVisible();
    }
    // Let the last reply fully settle (no typing, no thinking row) before scrolling away from the bottom.
    await expect(log.locator('.streaming')).toHaveCount(0);
    await expect(win.getByRole('status')).toHaveCount(0);
    await expect(win.getByRole('button', { name: /Max, Boss: (Done|Idle)/ })).toBeVisible();
    await log.evaluate((el) => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); });
    await expect.poll(() => log.evaluate((el) => el.scrollTop)).toBe(0);

    // Arrives without the composer, so nothing forces a scroll: you are still reading older messages.
    await win.evaluate(() => window.agentOffice.sendToBoss('ping while you are away'));
    const jump = win.getByRole('button', { name: /new messages?/ });
    await expect(log.locator('.msg.boss:not(.streaming)', { hasText: 'echo: ping while you are away' })).toBeAttached();
    try {
      await expect(jump).toHaveText('↓ 2 new messages');
    } catch (err) {
      const diag = await log.evaluate((el) => ({ ...el.dataset, scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, window: `${window.innerWidth}x${window.innerHeight}` }));
      await test.info().attach('chat-diagnostics', { body: JSON.stringify(diag, null, 2), contentType: 'application/json' });
      console.log('chat-diagnostics', JSON.stringify(diag));
      throw err;
    }
    const marker = win.getByRole('separator', { name: 'New messages' });
    await expect(marker).toBeAttached();
    await expect(marker).not.toBeInViewport();

    await jump.click();
    await expect(marker).toBeInViewport();
    await expect(jump).toHaveCount(0);

    await win.getByLabel('Message the boss').fill('thanks');
    await win.getByLabel('Message the boss').press('Enter');
    await expect(marker).toHaveCount(0);
  } finally {
    await app.close();
    await fs.rm(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    await fs.rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('starts a brand-new project from scratch', async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-e2e-new-'));
  const { app, userData } = await launch({ AO_CLAUDE_BIN: process.execPath, AO_CLAUDE_ARGS: JSON.stringify([FAKE]), AO_E2E_PICK_FOLDER: parent });
  try {
    const win = await app.firstWindow();
    await win.getByRole('radio', { name: /Start a new project/ }).click();
    await win.getByLabel('Project name').fill('Recipe App');
    await win.getByRole('button', { name: 'Choose…' }).click();
    await win.getByLabel(/What do you want to build/).fill('A small app to save recipes.');
    await win.getByRole('button', { name: /Create project/ }).click();
    await expect(win.getByRole('heading', { name: 'Recipe App' })).toBeVisible();
    await expect(win.locator('.msg.user', { hasText: 'A small app to save recipes.' })).toBeVisible();
    await expect(win.locator('.msg.boss', { hasText: 'echo: A small app to save recipes.' })).toBeVisible();
    expect(await fs.readFile(path.join(parent, 'Recipe App', 'README.md'), 'utf8')).toContain('# Recipe App');

    // The same flow is reachable from inside a project, and refuses to reuse a non-empty folder.
    await win.getByRole('button', { name: 'New project', exact: true }).click();
    await win.getByLabel('Project name').fill('Recipe App');
    await win.getByRole('button', { name: 'Choose…' }).click();
    await win.getByRole('button', { name: /Create project/ }).click();
    await expect(win.getByRole('alert')).toContainText('already exists');
    await win.getByRole('button', { name: 'Cancel' }).click();
    await expect(win.getByRole('dialog')).toHaveCount(0);

    // App settings live in the sidebar; project settings in the project's own tab.
    await win.getByRole('button', { name: 'App settings' }).click();
    await expect(win.getByRole('heading', { name: 'App settings' })).toBeVisible();
    await expect(win.getByRole('navigation', { name: 'Project views' })).toHaveCount(0);
    await win.getByRole('button', { name: 'Recipe App' }).click();
    await expect(win.locator('.agent-badge')).toHaveAttribute('title', /^Claude Code v\S+ · connected$/);
    await win.getByRole('navigation', { name: 'Project views' }).getByRole('button', { name: 'Settings' }).click();
    await expect(win.getByRole('heading', { name: 'Close project' })).toBeVisible();
    await expect(win.getByLabel(/Agents working at the same time/)).toBeVisible();
    await expect(win.getByRole('heading', { name: 'App settings' })).toHaveCount(0);
  } finally {
    await app.close();
    await fs.rm(parent, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    await fs.rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('explains what to do when Claude Code is not installed', async () => {
  const { app, userData } = await launch({ AO_CLAUDE_MISSING: '1' });
  try {
    const win = await app.firstWindow();
    await expect(win.getByRole('heading', { name: 'AgentOffice needs Claude Code' })).toBeVisible();
    await expect(win.getByRole('button', { name: 'Check again' })).toBeVisible();
  } finally {
    await app.close();
    await fs.rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('task cards open a details drawer', async () => {
  const repo = await makeRepo();
  const env = { AO_CLAUDE_BIN: process.execPath, AO_CLAUDE_ARGS: JSON.stringify([FAKE]), AO_E2E_PICK_FOLDER: repo };
  let { app, userData } = await launch(env);
  try {
    let win = await app.firstWindow();
    await win.getByRole('button', { name: 'Browse' }).click();
    await win.getByRole('button', { name: /Open the office/ }).click();
    await expect(win.getByRole('button', { name: /^Max, Boss/ })).toBeVisible();
    await app.close();

    // Seed the team and a reviewed task with a markdown result, then reopen the app on the same data.
    const pdir = await seedTeam(userData, [{ name: 'Pixel', roleId: 'frontend' }, { name: 'Byte', roleId: 'backend' }]);
    const pixel = (JSON.parse(await fs.readFile(path.join(pdir, 'agents.json'), 'utf8')) as { id: string; name: string }[]).find((a) => a.name === 'Pixel')!;
    const now = new Date().toISOString();
    await fs.writeFile(path.join(pdir, 'tasks.json'), JSON.stringify([{
      id: 'T-101', projectId: path.basename(pdir), title: 'Remove dead code', brief: 'Delete the **unused** views.', assigneeId: pixel.id, createdBy: 'boss',
      status: 'review', held: false, attempts: 1, branch: 'ao/pixel/remove-dead-code-t-101', dependsOn: [], createdAt: now, updatedAt: now,
      resultSummary: 'Done.\n\n- Removed `ComingSoonView`\n- Tests pass', diffStat: [{ path: 'src/a.ts', add: 0, del: 12 }],
      model: 'haiku', modelPick: { model: 'haiku', size: 'small', reason: 'Deletes a few files', source: 'classifier' },
    }, ...['Queue one', 'Queue two'].map((title, i) => ({
      // Waiting on T-101, so they stay queued until it is merged.
      id: `T-10${i + 2}`, projectId: path.basename(pdir), title, brief: 'later', assigneeId: pixel.id, createdBy: 'boss', status: 'queued', held: false, attempts: 0,
      branch: `ao/pixel/q-t-10${i + 2}`, dependsOn: ['T-101'], createdAt: new Date(Date.now() + i * 1000).toISOString(), updatedAt: now, model: 'haiku',
    }))]));
    // The reviewed task's branch must exist for the drag-to-Done merge.
    execFileSync('git', ['branch', 'ao/pixel/remove-dead-code-t-101'], { cwd: repo });
    ({ app, win } = await reopen(env, userData));
    // The size CI runs at: the board scrolls sideways, so drags must start with both ends on screen.
    await win.setViewportSize({ width: 1024, height: 645 });
    await win.getByRole('navigation', { name: 'Project views' }).getByRole('button', { name: /^Tasks/ }).click();

    const card = win.locator('.task-card', { hasText: 'Remove dead code' });
    await expect(card).not.toContainText('Removed');
    await card.getByRole('button', { name: 'Remove dead code' }).click();
    const drawer = win.getByRole('dialog', { name: 'Remove dead code' });
    await expect(drawer).toBeVisible();
    await expect(drawer.locator('strong', { hasText: 'unused' })).toBeVisible();
    await expect(drawer.locator('li', { hasText: 'Removed' }).locator('code')).toHaveText('ComingSoonView');
    await expect(drawer).toContainText('haiku · small — Deletes a few files');
    await expect(drawer).toContainText('src/a.ts');
    await expect(drawer.getByRole('button', { name: 'Cancel task' })).toBeVisible();
    await win.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Remove dead code' })).toBeFocused();

    // Drag and drop: reorder the queue, then the same move back from the details panel.
    const queued = win.getByRole('region', { name: 'Queued' });
    const titles = () => queued.locator('.card-open').allTextContents();
    expect(await titles()).toEqual(['Queue one', 'Queue two']);
    await queued.locator('.task-card', { hasText: 'Queue two' }).dragTo(queued.locator('.task-card', { hasText: 'Queue one' }), { targetPosition: { x: 20, y: 5 } });
    await expect.poll(titles).toEqual(['Queue two', 'Queue one']);
    await queued.getByRole('button', { name: 'Queue two' }).click();
    await win.getByRole('dialog', { name: 'Queue two' }).getByRole('button', { name: 'Move down' }).click();
    await expect.poll(titles).toEqual(['Queue one', 'Queue two']);
    await win.keyboard.press('Escape');

    // Drop a queued card on a teammate's avatar to hand it over (the strip appears once the drag starts).
    const one = queued.locator('.task-card', { hasText: 'Queue one' });
    const box = (await one.boundingBox())!;
    await win.mouse.move(box.x + 20, box.y + 20);
    await win.mouse.down();
    await win.mouse.move(box.x + 30, box.y + 40, { steps: 4 });
    const toByte = queued.locator('.handover-target', { hasText: 'Byte' });
    await expect(toByte).toBeVisible();
    const tb = (await toByte.boundingBox())!;
    await win.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 6 });
    await win.mouse.up();
    await expect(one).toContainText('Byte');

    // Review to Done merges it.
    // Scrolling the board mid-drag cancels a native drag, so bring Done (and the card beside it) into view first.
    await win.getByRole('region', { name: 'Done' }).scrollIntoViewIfNeeded();
    await card.dragTo(win.getByRole('region', { name: 'Done' }));
    await expect(win.getByRole('region', { name: 'Done' }).locator('.task-card', { hasText: 'Remove dead code' })).toBeVisible();
  } finally {
    await app.close();
    await fs.rm(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    await fs.rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('a project terminal runs commands in the project folder', async () => {
  const repo = await makeRepo();
  const env = { AO_CLAUDE_BIN: process.execPath, AO_CLAUDE_ARGS: JSON.stringify([FAKE]), AO_E2E_PICK_FOLDER: repo };
  const { app, userData } = await launch(env);
  try {
    const win = await app.firstWindow();
    await win.getByRole('button', { name: 'Browse' }).click();
    await win.getByRole('button', { name: /Open the office/ }).click();
    const toggle = win.getByRole('button', { name: 'Terminal' });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    const term = win.locator('.terminal-host');
    await expect(term).toBeVisible();
    await term.click();
    await win.keyboard.type('echo ao-terminal-ok');
    await win.keyboard.press('Enter');
    // The echoed command and its output: at least two copies once the command has run.
    await expect.poll(async () => ((await term.innerText()).match(/ao-terminal-ok/g) ?? []).length, { timeout: 20000 }).toBeGreaterThanOrEqual(2);

    // Hiding and showing keeps the same shell and its output; Ctrl+` toggles too.
    await toggle.click();
    await expect(term).toBeHidden();
    await win.keyboard.press('Control+Backquote');
    await expect(term).toBeVisible();
    await expect(term).toContainText('ao-terminal-ok');
    await expect(win.getByRole('separator', { name: 'Resize terminal' })).toBeVisible();
  } finally {
    await app.close();
    await fs.rm(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    await fs.rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('history shows what the team merged, file by file', async () => {
  const repo = await makeRepo();
  const run = (...args: string[]) => execFileSync('git', args, { cwd: repo });
  await fs.writeFile(path.join(repo, 'docs.md'), 'docs\n');
  run('add', '.'); run('commit', '-q', '-m', 'Write docs');
  run('checkout', '-q', '-b', 'ao/pixel/greeting-t-101');
  await fs.writeFile(path.join(repo, 'greet.ts'), 'export const hi = "hello";\n');
  run('add', '.'); run('commit', '-q', '-m', 'Add a greeting');
  run('checkout', '-q', 'main');
  run('merge', '--no-ff', '-q', '-m', 'Merge T-101: Add a greeting', 'ao/pixel/greeting-t-101');
  const env = { AO_CLAUDE_BIN: process.execPath, AO_CLAUDE_ARGS: JSON.stringify([FAKE]), AO_E2E_PICK_FOLDER: repo };
  let { app, userData } = await launch(env);
  try {
    let win = await app.firstWindow();
    await win.getByRole('button', { name: 'Browse' }).click();
    await win.getByRole('button', { name: /Open the office/ }).click();
    await win.getByRole('navigation', { name: 'Project views' }).getByRole('button', { name: 'History' }).click();

    const list = win.getByRole('region', { name: 'Commits' });
    await expect(list.locator('.commit-subject')).toHaveText([/T-101\s*Merge T-101: Add a greeting/, 'Write docs', 'init']);
    await list.getByRole('button', { name: /Merge T-101/ }).click();
    const detail = win.getByRole('region', { name: 'Commit details' });
    await expect(detail.getByRole('heading', { name: 'Merge T-101: Add a greeting' })).toBeVisible();
    await detail.getByRole('button', { name: /greet\.ts/ }).click();
    await expect(win.getByRole('region', { name: 'Changes to greet.ts' }).locator('.diff-line.add')).toContainText(['+export const hi = "hello";']);

    await win.getByLabel('Team merges only').check();
    await expect(list.locator('.commit-subject')).toHaveText([/Merge T-101/]);
    await win.getByLabel('Branch').selectOption('ao/pixel/greeting-t-101');
    await expect(list.locator('.commit-subject')).toHaveCount(0);
    await win.getByLabel('Team merges only').uncheck();
    await expect(list.locator('.commit-subject').first()).toHaveText('Add a greeting');

    // Relaunching reopens the project on the same tab, branch and filter, with no trip through onboarding.
    await win.getByLabel('Team merges only').check();
    await app.close();
    ({ app } = await launch(env, userData));
    win = await app.firstWindow();
    await expect(win.getByRole('region', { name: 'Commits' })).toBeVisible();
    await expect(win.getByLabel('Branch')).toHaveValue('ao/pixel/greeting-t-101');
    await expect(win.getByLabel('Team merges only')).toBeChecked();
    await expect(win.getByRole('button', { name: 'Browse' })).toHaveCount(0);
  } finally {
    await app.close();
    await fs.rm(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    await fs.rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('the Preview tab shows an employee\'s browser tab live', async () => {
  const repo = await makeRepo();
  await addFixtureServer(repo);
  const env = {
    AO_CLAUDE_BIN: process.execPath, AO_CLAUDE_ARGS: JSON.stringify([FAKE]), AO_E2E_PICK_FOLDER: repo,
    FAKE_CLAUDE_MCP_CALLS: JSON.stringify([{ tool: 'start_dev_server', args: { command: 'node server.mjs' } }, { tool: 'browser_open', args: { url: '$URL' } }]),
  };
  let { app, userData } = await launch(env);
  try {
    let win = await app.firstWindow();
    await win.getByRole('button', { name: 'Browse' }).click();
    await win.getByRole('button', { name: /Open the office/ }).click();
    await expect(win.getByRole('button', { name: /^Max, Boss/ })).toBeVisible();
    await app.close();
    const pdir = await seedTeam(userData, [{ name: 'Pixel', roleId: 'frontend' }]);
    const pixel = (JSON.parse(await fs.readFile(path.join(pdir, 'agents.json'), 'utf8')) as { id: string; name: string }[]).find((a) => a.name === 'Pixel')!;
    const now = new Date().toISOString();
    await fs.writeFile(path.join(pdir, 'tasks.json'), JSON.stringify([{
      id: 'T-101', projectId: path.basename(pdir), title: 'Check the page', brief: 'look', assigneeId: pixel.id, createdBy: 'boss', status: 'queued',
      held: false, attempts: 0, branch: 'ao/pixel/check-t-101', dependsOn: [], createdAt: now, updatedAt: now, model: 'haiku',
    }]));
    ({ app, win } = await reopen(env, userData));
    await win.getByRole('navigation', { name: 'Project views' }).getByRole('button', { name: 'Preview' }).click();
    await expect(win.getByLabel('Employee')).toHaveValue(pixel.id, { timeout: 30_000 });
    const live = win.getByLabel(/Live view of Pixel/);
    await expect.poll(async () => Number(await live.getAttribute('data-frames')), { timeout: 20_000 }).toBeGreaterThan(0);
    await live.click({ position: { x: 20, y: 20 } });
  } finally {
    await app.close();
    await fs.rm(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    await fs.rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
