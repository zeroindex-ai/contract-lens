/**
 * Regenerate the verification fields (confidence, verified_page, match_quality)
 * on every sample JSON by running verify() against the actual PDF text.
 *
 * Workflow:
 *   1. Edit samples/source/<id>.html (and re-run build-sample-pdfs.ts)
 *   2. Edit the model-side fields of public/samples/<id>.json:
 *      value, evidence_quote, evidence_page (and parties[].name/role/quote/page)
 *   3. Run this script — verification fields are recomputed and the JSON
 *      written back. Commit both the JSON and the PDF together.
 *
 * The point: sample JSONs are NEVER hand-authored verification states.
 * verify() is the source of truth, so changes to verify() automatically
 * propagate to samples on the next run.
 *
 * Usage:  pnpm tsx scripts/build-sample-extractions.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { ContractExtractionSchema } from '../src/schema/extraction';
import { extractPdfText } from '../src/lib/pdf-text';
import { verify } from '../src/lib/verify';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLES_DIR = join(ROOT, 'public', 'samples');

const ManifestSchema = z.object({
  samples: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      subtitle: z.string(),
      blurb: z.string(),
      page_count: z.number(),
      pdf_path: z.string(),
      json_path: z.string(),
    })
  ),
});

async function main() {
  const manifest = ManifestSchema.parse(JSON.parse(readFileSync(join(SAMPLES_DIR, 'manifest.json'), 'utf-8')));

  for (const sample of manifest.samples) {
    const pdfPath = join(SAMPLES_DIR, `${sample.id}.pdf`);
    const jsonPath = join(SAMPLES_DIR, `${sample.id}.json`);

    // 1. Read the existing JSON; strip verification fields to recover model-side shape.
    const existing = JSON.parse(readFileSync(jsonPath, 'utf-8'));
    const modelSide = stripVerification(existing);
    const parsed = ContractExtractionSchema.parse(modelSide);

    // 2. Read the PDF and pull per-page text.
    const buf = new Uint8Array(readFileSync(pdfPath));
    const { pageCount, pageTexts } = await extractPdfText(buf);

    // 3. Run verify() to compute confidence/verified_page/match_quality.
    const verified = verify(parsed, pageTexts);

    // 4. Write back the verified JSON, pretty-printed.
    writeFileSync(jsonPath, JSON.stringify(verified, null, 2) + '\n', 'utf-8');

    // 5. Report.
    const allFields = [
      ...verified.parties,
      verified.effective_date,
      verified.term,
      verified.payment_terms,
      verified.deliverables,
      verified.ip_ownership,
      verified.termination_clause,
      verified.governing_law,
      verified.kill_fee,
      verified.limitation_of_liability,
    ];
    const counts: Record<string, number> = {};
    for (const f of allFields) counts[f.match_quality] = (counts[f.match_quality] ?? 0) + 1;
    const meanConfidence = allFields.reduce((s, f) => s + f.confidence, 0) / allFields.length;
    console.log(
      `✓ ${sample.id.padEnd(36)} pages=${pageCount}  mean=${meanConfidence.toFixed(2)}  ${JSON.stringify(counts)}`
    );

    if (sample.page_count !== pageCount) {
      console.warn(
        `  ⚠ manifest.page_count (${sample.page_count}) ≠ actual (${pageCount}); update manifest`
      );
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function stripVerification(obj: any): any {
  const strip = (f: { value: unknown; evidence_quote: unknown; evidence_page: unknown }) => ({
    value: f.value,
    evidence_quote: f.evidence_quote,
    evidence_page: f.evidence_page,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stripParty = (p: any) => ({
    name: p.name,
    role: p.role,
    evidence_quote: p.evidence_quote,
    evidence_page: p.evidence_page,
  });
  return {
    parties: obj.parties.map(stripParty),
    effective_date: strip(obj.effective_date),
    term: strip(obj.term),
    payment_terms: strip(obj.payment_terms),
    deliverables: strip(obj.deliverables),
    ip_ownership: strip(obj.ip_ownership),
    termination_clause: strip(obj.termination_clause),
    governing_law: strip(obj.governing_law),
    kill_fee: strip(obj.kill_fee),
    limitation_of_liability: strip(obj.limitation_of_liability),
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
