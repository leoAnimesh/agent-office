import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeRepo } from '../test/helpers/repo';

const FAKE = path.resolve('test/fake-claude/fake-claude.mjs');

async function launch(env: Record<string, string>): Promise<{ app: ElectronApplication; userData: string }> {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-e2e-'));
  const base = { ...process.env } as Record<string, string>;
  delete base.ELECTRON_RENDERER_URL;
  const args = process.platform === 'linux' ? ['--no-sandbox', path.resolve('.')] : [path.resolve('.')];
  const app = await electron.launch({ args, env: { ...base, AO_USER_DATA: userData, ...env } });
  return { app, userData };
}

test('first launch → open a repo → chat with the boss → hire → see the desk', async () => {
  const repo = await makeRepo();
  const { app, userData } = await launch({ AO_CLAUDE_BIN: process.execPath, AO_CLAUDE_ARGS: JSON.stringify([FAKE]), AO_E2E_PICK_FOLDER: repo });
  try {
    const win = await app.firstWindow();
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

    await win.getByRole('navigation', { name: 'Project views' }).getByRole('button', { name: 'Team' }).click();
    await win.getByRole('button', { name: /^Frontend Engineer/ }).click();
    await win.getByRole('button', { name: 'Hire Frontend Engineer' }).click();
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

    // The sidebar collapses to an icon rail that keeps every item usable, and remembers it.
    await win.getByRole('button', { name: 'Collapse sidebar' }).click();
    await expect(win.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute('aria-expanded', 'false');
    await win.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(win.locator('.cli-card')).toHaveAttribute('title', /^Claude Code v\S+ · connected$/);
    await win.reload();
    await expect(win.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
    await win.getByRole('button', { name: 'Expand sidebar' }).click();
    await expect(win.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible();
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
    await win.getByRole('navigation', { name: 'Project views' }).getByRole('button', { name: 'Team' }).click();
    await win.getByRole('button', { name: /^Frontend Engineer/ }).click();
    await win.getByRole('button', { name: 'Hire Frontend Engineer' }).click();
    await expect(win.getByRole('button', { name: /^Open$/ }).nth(1)).toBeVisible();
    await app.close();

    // Seed a reviewed task with a markdown result, then reopen the app on the same data.
    const pdir = path.join(userData, 'projects', (await fs.readdir(path.join(userData, 'projects')))[0]);
    const pixel = (JSON.parse(await fs.readFile(path.join(pdir, 'agents.json'), 'utf8')) as { id: string; name: string }[]).find((a) => a.name === 'Pixel')!;
    const now = new Date().toISOString();
    await fs.writeFile(path.join(pdir, 'tasks.json'), JSON.stringify([{
      id: 'T-101', projectId: path.basename(pdir), title: 'Remove dead code', brief: 'Delete the **unused** views.', assigneeId: pixel.id, createdBy: 'boss',
      status: 'review', held: false, attempts: 1, branch: 'ao/pixel/remove-dead-code-t-101', dependsOn: [], createdAt: now, updatedAt: now,
      resultSummary: 'Done.\n\n- Removed `ComingSoonView`\n- Tests pass', diffStat: [{ path: 'src/a.ts', add: 0, del: 12 }],
      model: 'haiku', modelPick: { model: 'haiku', size: 'small', reason: 'Deletes a few files', source: 'classifier' },
    }]));
    const base = { ...process.env } as Record<string, string>;
    delete base.ELECTRON_RENDERER_URL;
    app = await electron.launch({ args: process.platform === 'linux' ? ['--no-sandbox', path.resolve('.')] : [path.resolve('.')], env: { ...base, AO_USER_DATA: userData, ...env } });
    win = await app.firstWindow();
    const browse = win.getByRole('button', { name: 'Browse' });
    await expect(browse.or(win.getByRole('button', { name: /^Max, Boss/ }))).toBeVisible();
    if (await browse.isVisible()) {
      await win.getByRole('button', { name: 'Browse' }).click();
      await win.getByRole('button', { name: /Open the office/ }).click();
    }
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
  } finally {
    await app.close();
    await fs.rm(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    await fs.rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
