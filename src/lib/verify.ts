import type { DocumentExtraction, ContractParty, KeyDetail } from '@/schema/extraction';
import { match } from './match';

/**
 * Verification of a model-produced extraction against the actual PDF text.
 *
 * For every cited item (party or key detail) the model returns, deterministically
 * check whether its `evidence_quote` appears on the claimed page; if not, check
 * neighboring pages (±2). The result is a `match_quality` tag and a `confidence`
 * score the UI uses to color-code each row. There is no "absent" state to verify
 * — the model simply omits details that aren't in the document.
 */

export type MatchQuality =
  | 'exact' // verbatim substring on claimed page
  | 'normalized' // matches after whitespace/quote/dash normalization
  | 'fuzzy' // sliding-window Dice ≥ threshold on claimed page
  | 'wrong-page' // quote found, but on a different page than claimed
  | 'not-found'; // quote not found in claimed page or neighbors (model hallucination)

/** Fields the verification layer adds to any cited item. */
export interface Verified {
  confidence: number; // 0..1
  verified_page: number | null; // page where the quote actually was; null if not found
  match_quality: MatchQuality;
}

export type VerifiedParty = ContractParty & Verified;
export type VerifiedKeyDetail = KeyDetail & Verified;

export interface VerifiedDocumentExtraction {
  document_type: string;
  summary: string;
  parties: VerifiedParty[];
  key_details: VerifiedKeyDetail[];
}

/** How far to look beyond the claimed page when the quote isn't found there. */
const NEIGHBOR_RADIUS = 2;

/** Confidence assigned when the quote is found, but on a different page than the
 *  model claimed (wrong-page). Low by design — the citation is real but the
 *  model mis-located it, so the row warrants review. */
const WRONG_PAGE_CONFIDENCE = 0.4;

/**
 * Verify an extraction against per-page PDF text. `pageTexts` is 0-indexed;
 * the model's `evidence_page` is 1-indexed.
 */
export function verify(extraction: DocumentExtraction, pageTexts: string[]): VerifiedDocumentExtraction {
  return {
    document_type: extraction.document_type,
    summary: extraction.summary,
    parties: extraction.parties.map((p) => locate(p, p.evidence_quote, p.evidence_page, pageTexts)),
    key_details: extraction.key_details.map((d) => locate(d, d.evidence_quote, d.evidence_page, pageTexts)),
  };
}

/* -------------------------------------------------------------------------- */
/* Page-search core                                                           */
/* -------------------------------------------------------------------------- */

function locate<T extends object>(
  item: T,
  quote: string,
  claimedPage: number,
  pageTexts: string[]
): T & Verified {
  const claimedIdx = claimedPage - 1; // 1-indexed → 0-indexed

  // 1) Try the claimed page first.
  if (claimedIdx >= 0 && claimedIdx < pageTexts.length) {
    const m = match(quote, pageTexts[claimedIdx]);
    if (m.strength !== 'none') {
      return { ...item, confidence: m.score, verified_page: claimedPage, match_quality: m.strength };
    }
  }

  // 2) Try neighboring pages within NEIGHBOR_RADIUS.
  for (let delta = 1; delta <= NEIGHBOR_RADIUS; delta++) {
    for (const candidate of [claimedIdx - delta, claimedIdx + delta]) {
      if (candidate < 0 || candidate >= pageTexts.length) continue;
      const m = match(quote, pageTexts[candidate]);
      if (m.strength !== 'none') {
        return {
          ...item,
          confidence: WRONG_PAGE_CONFIDENCE,
          verified_page: candidate + 1,
          match_quality: 'wrong-page',
        };
      }
    }
  }

  // 3) Not found anywhere within radius — likely hallucinated.
  return { ...item, confidence: 0, verified_page: null, match_quality: 'not-found' };
}
