import { test, expect } from '@playwright/test';

// Smoke test — replaced by the real three e2e tests in task #14 once the demo
// UI lands. Keeping a single passing test here so CI's playwright step is wired
// from commit 1 instead of being dormant.
test('homepage renders and has the lens heading', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Document intelligence');
});
