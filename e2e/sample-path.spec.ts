import { test, expect } from '@playwright/test';

// Sample-path e2e: exercises the full extraction viewer without calling the
// live API. Picking a sample loads its pre-verified JSON from /samples, so
// these tests are deterministic and cover the three verification outcomes the
// product is built to surface: clean, mis-paginated, and hallucinated citations.

async function openSample(page: import('@playwright/test').Page, title: string) {
  await page.goto('/');
  await page.getByRole('button', { name: `Open sample: ${title}` }).click();
  // Viewer has landed once the back link is shown.
  await expect(page.getByRole('button', { name: 'BACK TO SAMPLES' })).toBeVisible();
}

test('clean contract verifies with no warning banner', async ({ page }) => {
  await openSample(page, 'Consulting MSA');

  // Parties and a known field value render in the citations pane.
  const pane = page.locator('.citations-pane');
  await expect(pane.getByText(/Meridian Health/)).toBeVisible();
  await expect(pane.getByText('New York', { exact: true })).toBeVisible();

  // Summary strip is present and nothing failed verification → no banner.
  await expect(page.getByText('verified', { exact: true })).toBeVisible();
  await expect(page.locator('.warning-banner')).toHaveCount(0);
});

test('mis-paginated citation is flagged as wrong-page', async ({ page }) => {
  await openSample(page, 'Fixed-fee SOW');

  // The verification warning banner appears for the low-confidence field.
  await expect(page.locator('.warning-banner')).toContainText(
    /couldn.t be verified against the source PDF/
  );

  // The term field shows the "found on a different page" reconciliation.
  await expect(page.getByText(/found on p\./)).toBeVisible();
});

test('hallucinated quote is flagged as not-found', async ({ page }) => {
  await openSample(page, 'Contributor License Agreement');

  await expect(page.locator('.warning-banner')).toContainText(
    /couldn.t be verified against the source PDF/
  );
  await expect(page.getByText('quote not found in PDF')).toBeVisible();
});

test('every citation on the page is highlighted, and clicking one selects its field', async ({
  page,
}) => {
  await openSample(page, 'Consulting MSA');

  // The PDF renders and more than one citation is highlighted on the opening page.
  const highlights = page.locator('.textLayer span[data-mark-key]');
  await expect(highlights.first()).toBeVisible({ timeout: 20000 });
  const keys = await highlights.evaluateAll((els) => [
    ...new Set(els.map((e) => (e as HTMLElement).dataset.markKey)),
  ]);
  expect(keys.length).toBeGreaterThan(1);

  // Highlights are band-colored (the clean MSA verifies green).
  await expect(page.locator('.textLayer span.hl-green').first()).toBeVisible();

  // Clicking the Term highlight selects the Term row AND gives that highlight the ring.
  await page.locator('.textLayer span[data-mark-key="field:term"]').first().click();
  await expect(page.locator('.field-row.active')).toContainText('Term');
  await expect(page.locator('.textLayer span[data-mark-key="field:term"].hl-selected').first()).toBeVisible();
});
