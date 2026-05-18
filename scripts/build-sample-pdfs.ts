/**
 * Render each samples/source/<id>.html to public/samples/<id>.pdf via
 * Playwright Chromium. Run once after editing any of the source files;
 * commit both the source and the generated PDF.
 *
 * Usage: pnpm tsx scripts/build-sample-pdfs.ts
 *
 * Playwright (chromium) is already installed as a devDep for E2E, so this
 * adds no new dependency. The browser binary lives at ~/.cache/ms-playwright
 * after `pnpm exec playwright install chromium`.
 */

import { chromium } from '@playwright/test';
import { readdirSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = join(ROOT, 'samples', 'source');
const OUT_DIR = join(ROOT, 'public', 'samples');

async function main() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const sources = readdirSync(SOURCE_DIR)
    .filter((f) => f.endsWith('.html'))
    .sort();

  if (sources.length === 0) {
    console.error('No .html files found under samples/source/');
    process.exit(1);
  }

  const browser = await chromium.launch();
  try {
    for (const file of sources) {
      const id = file.replace(/\.html$/, '');
      const out = join(OUT_DIR, `${id}.pdf`);
      const url = pathToFileURL(join(SOURCE_DIR, file)).toString();
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.pdf({
        path: out,
        format: 'letter',
        printBackground: true,
        margin: { top: '0.5in', right: '0.5in', bottom: '0.5in', left: '0.5in' },
      });
      await page.close();
      console.log(`✓ ${id}.pdf`);
    }
  } finally {
    await browser.close();
  }

  console.log(`\nWrote ${sources.length} PDF(s) to public/samples/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
