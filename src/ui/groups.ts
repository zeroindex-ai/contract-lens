import type { VerifiedDocumentExtraction } from '@/lib/verify';
import { bandFor } from './confidence';

export interface ExtractionSummary {
  verified: number; // green band
  review: number; // amber + red bands
  total: number; // parties + key details
}

/** Count cited items (parties + key details) per confidence band. */
export function summarize(verified: VerifiedDocumentExtraction): ExtractionSummary {
  const all = [...verified.parties, ...verified.key_details];
  let v = 0;
  let r = 0;
  for (const f of all) {
    if (bandFor(f.confidence) === 'green') v++;
    else r++; // amber + red
  }
  return { verified: v, review: r, total: all.length };
}
