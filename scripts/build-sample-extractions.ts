/**
 * Regenerate the verified sample JSONs (public/samples/<id>.json) by running
 * verify() against the actual PDF text.
 *
 * Source of truth is the hand-authored MODEL-SIDE extraction in
 * samples/extractions/<id>.json (DocumentExtraction shape: document_type,
 * summary, parties, key_details — each with a verbatim evidence_quote + page).
 * This script verifies each against samples' PDF and writes the verified result
 * to public/samples/<id>.json. Verification fields (confidence, verified_page,
 * match_quality) are NEVER hand-authored — verify() is the source of truth.
 *
 * Usage:  pnpm tsx scripts/build-sample-extractions.ts
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DocumentExtractionSchema } from '../src/schema/extraction';
import { extractPdfText } from '../src/lib/pdf-text';
import { verify } from '../src/lib/verify';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = join(ROOT, 'samples', 'extractions');
const OUT_DIR = join(ROOT, 'public', 'samples');

async function main() {
  if (!existsSync(SRC_DIR)) {
    console.error(`No model-side extractions at ${SRC_DIR}`);
    process.exit(1);
  }
  const ids = readdirSync(SRC_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();

  for (const id of ids) {
    const modelSide = DocumentExtractionSchema.parse(
      JSON.parse(readFileSync(join(SRC_DIR, `${id}.json`), 'utf-8'))
    );
    const buf = new Uint8Array(readFileSync(join(OUT_DIR, `${id}.pdf`)));
    const { pageCount, pageTexts } = await extractPdfText(buf);
    const verified = verify(modelSide, pageTexts);

    writeFileSync(join(OUT_DIR, `${id}.json`), JSON.stringify(verified, null, 2) + '\n', 'utf-8');

    const items = [...verified.parties, ...verified.key_details];
    const counts: Record<string, number> = {};
    for (const f of items) counts[f.match_quality] = (counts[f.match_quality] ?? 0) + 1;
    const mean = items.reduce((s, f) => s + f.confidence, 0) / (items.length || 1);
    console.log(
      `✓ ${id.padEnd(34)} pages=${pageCount}  items=${items.length}  mean=${mean.toFixed(2)}  ${JSON.stringify(counts)}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
