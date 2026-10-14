import { defineConfig } from '@playwright/test';

// Generous assertion timeout: CI runners (Windows Defender, Linux xvfb) can be slow to spawn processes.
export default defineConfig({ testDir: 'e2e', timeout: 120_000, expect: { timeout: 20_000 }, workers: 1, reporter: 'list' });
