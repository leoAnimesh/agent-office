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
