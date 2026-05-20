/**
 * Copy the pdfjs-dist web worker into public/ so the browser PDF preview can
 * load it from a stable URL (/pdf.worker.min.mjs). Runs on predev/prebuild so
 * the worker always matches the installed pdfjs-dist version — no committed
 * binary that goes stale on a dependency bump.
 */
import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Resolve the package root via its package.json, then locate the worker build.
const pkgJson = require.resolve('pdfjs-dist/package.json');
const src = join(dirname(pkgJson), 'build', 'pdf.worker.min.mjs');

const destDir = join(ROOT, 'public');
mkdirSync(destDir, { recursive: true });
const dest = join(destDir, 'pdf.worker.min.mjs');

copyFileSync(src, dest);
console.log(`copied pdf worker → public/pdf.worker.min.mjs`);
