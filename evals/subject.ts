// Eval subject for contract-lens.
//
// The eval-pack `Subject` contract is `(question: string) => Promise<AnswerResult>`.
// Here `question` is a sample id (e.g. "mutual-nda"); the subject loads that
// sample PDF, runs the real production pipeline — extractPdfText → extract()
// (live Claude call) → verify() — and returns:
//   - text:     a human-readable summary of the extracted fields (shown in the report)
//   - metadata: { extraction } — the VerifiedContractExtraction the checks inspect
//
// Requires ANTHROPIC_API_KEY in the environment (extract() calls the Messages API).

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Subject } from '@zeroindex-ai/eval-pack';
import { extract } from '@/lib/extract';
import { verify } from '@/lib/verify';
import type { VerifiedContractExtraction } from '@/lib/verify';
import { extractPdfText } from '@/lib/pdf-text';
import { SCALAR_FIELD_KEYS, FIELD_LABELS } from '@/schema/extraction';

const SAMPLES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'samples');

function summarize(extraction: VerifiedContractExtraction): string {
  const lines: string[] = [];
  const parties = extraction.parties
    .map((p) => `${p.name} (${p.role}) [${p.match_quality}]`)
    .join('; ');
  lines.push(`${FIELD_LABELS.parties}: ${parties || '—'}`);
  for (const key of SCALAR_FIELD_KEYS) {
    const f = extraction[key];
    const value = f.value === null ? 'not in contract' : `${f.value} [${f.match_quality}]`;
    lines.push(`${FIELD_LABELS[key]}: ${value}`);
  }
  return lines.join('\n');
}

export const subject: Subject = async (question) => {
  const pdfPath = join(SAMPLES_DIR, `${question}.pdf`);
  const pdfBuffer = new Uint8Array(await readFile(pdfPath));

  const t0 = Date.now();
  const { pageTexts } = await extractPdfText(pdfBuffer);
  const { extraction, metadata } = await extract(pdfBuffer);
  const verified = verify(extraction, pageTexts);
  const totalMs = Date.now() - t0;

  return {
    text: summarize(verified),
    metadata: { extraction: verified, model: metadata.model, totalMs },
  };
};
