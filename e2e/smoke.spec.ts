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
