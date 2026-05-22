import { test, expect } from '@playwright/test';

// Sample-path e2e: exercises the full viewer without calling the live API.
// Picking a sample loads its pre-verified JSON from /samples, so these are
// deterministic. The samples are clean (verbatim quotes), so they cover the
// happy path; flagged-citation behavior is covered by the unit tests.

async function openSample(page: import('@playwright/test').Page, title: string) {
  await page.goto('/');
  await page.getByRole('button', { name: `Open sample: ${title}` }).click();
  await expect(page.getByRole('button', { name: 'BACK TO SAMPLES' })).toBeVisible();
}

test('clean document verifies — type header, status, parties, key details', async ({ page }) => {
  await openSample(page, 'Mutual NDA');

  await expect(page.locator('.doc-type')).toContainText(/Non-Disclosure/i);
  await expect(page.locator('.verify-status.ok')).toContainText('Fully verified');

  const pane = page.locator('.citations-pane');
  await expect(pane.getByText(/Acme Robotics/)).toBeVisible();
  await expect(pane.getByText('Governing law')).toBeVisible(); // a dynamic key-detail label

  await expect(page.locator('.warning-banner')).toHaveCount(0);
});

test('a non-contract document works (the general pivot)', async ({ page }) => {
  await openSample(page, 'Commercial Invoice');

  await expect(page.locator('.doc-type')).toContainText('Commercial Invoice');
  await expect(page.locator('.citations-pane')).toContainText('Total due');
});

test('every citation on the page is highlighted, and clicking one selects its row', async ({ page }) => {
  await openSample(page, 'Mutual NDA');

  const highlights = page.locator('.textLayer span[data-mark-key]');
  await expect(highlights.first()).toBeVisible({ timeout: 20000 });
  const keys = await highlights.evaluateAll((els) => [
    ...new Set(els.map((e) => (e as HTMLElement).dataset.markKey)),
  ]);
  expect(keys.length).toBeGreaterThan(1);

  await expect(page.locator('.citation-hint')).toContainText(/\d+ citations? highlighted on this page/);

  // Clicking the first key detail's highlight selects its row + rings it.
  await page.locator('.textLayer span[data-mark-key="detail:0"]').first().click();
  await expect(page.locator('.field-row.active')).toContainText('Effective date');
  await expect(page.locator('.textLayer span[data-mark-key="detail:0"].hl-selected').first()).toBeVisible();
});

test('refreshing the viewer keeps the document loaded (no re-upload)', async ({ page }) => {
  await openSample(page, 'Mutual NDA');
  await page.reload();
  await expect(page.getByRole('button', { name: 'BACK TO SAMPLES' })).toBeVisible();
  await expect(page.locator('.doc-type')).toContainText(/Non-Disclosure/i);

  await page.getByRole('button', { name: 'BACK TO SAMPLES' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'BACK TO SAMPLES' })).toHaveCount(0);
});
