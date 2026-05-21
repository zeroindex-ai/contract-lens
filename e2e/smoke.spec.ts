import { test, expect } from '@playwright/test';

// Smoke test for the landing page. The full viewer flows live in
// sample-path.spec.ts.
test('homepage renders and has the lens heading', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Document intelligence');
});
