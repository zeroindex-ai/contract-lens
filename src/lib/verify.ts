import type { ContractExtraction, ContractField, ContractParty, ScalarFieldKey } from '@/schema/extraction';
import { SCALAR_FIELD_KEYS } from '@/schema/extraction';
import { match } from './match';

/**
 * Verification of a model-produced extraction against the actual PDF text.
 *
 * For every field that has a non-null evidence_quote, deterministically check
 * whether that quote appears in the claimed page's extracted text. If not,
 * also check neighboring pages (±2). The result is a `match_quality` tag and
 * a `confidence` score the UI uses to color-code each field.
 *
 * For fields the model marked as "not in this contract" (all-null), we don't
 * verify — we can't disprove a negative from text-matching alone. The UI
 * shows those as gray "not in contract" rather than green/amber/red.
 */

export type MatchQuality =
  | 'exact' // verbatim substring on claimed page
  | 'normalized' // matches after whitespace/quote/dash normalization
  | 'fuzzy' // sliding-window Dice ≥ threshold on claimed page
  | 'wrong-page' // quote found, but on a different page than claimed
  | 'not-found' // quote not found in claimed page or neighbors (model hallucination)
  | 'null-field' // model said field is not in contract (only applies to scalar Fields, not parties)
  | 'incomplete'; // model returned partial-null field (rare; verification skipped)

export type VerifiedField = ContractField & {
  confidence: number; // 0..1
  verified_page: number | null; // page where the quote actually was; null if not found
  match_quality: MatchQuality;
};

export type VerifiedParty = ContractParty & {
  confidence: number;
  verified_page: number | null;
  match_quality: Exclude<MatchQuality, 'null-field' | 'incomplete'>;
};

export type VerifiedContractExtraction = {
  parties: VerifiedParty[];
  effective_date: VerifiedField;
  term: VerifiedField;
  payment_terms: VerifiedField;
  deliverables: VerifiedField;
  ip_ownership: VerifiedField;
  termination_clause: VerifiedField;
  governing_law: VerifiedField;
  kill_fee: VerifiedField;
  limitation_of_liability: VerifiedField;
};

/** How far to look beyond the claimed page when the quote isn't found there. */
const NEIGHBOR_RADIUS = 2;

/**
 * Verify an extraction against per-page PDF text. `pageTexts` is 0-indexed;
 * the model's `evidence_page` is 1-indexed.
 */
export function verify(extraction: ContractExtraction, pageTexts: string[]): VerifiedContractExtraction {
  const verifiedScalars: Record<ScalarFieldKey, VerifiedField> = {} as Record<ScalarFieldKey, VerifiedField>;
  for (const key of SCALAR_FIELD_KEYS) {
    verifiedScalars[key] = verifyField(extraction[key], pageTexts);
  }

  return {
    parties: extraction.parties.map((p) => verifyParty(p, pageTexts)),
    ...verifiedScalars,
  };
}

/* -------------------------------------------------------------------------- */
/* Per-field verification                                                     */
/* -------------------------------------------------------------------------- */

function verifyField(field: ContractField, pageTexts: string[]): VerifiedField {
  const { value, evidence_quote, evidence_page } = field;

  // All-null = model said this field isn't in the contract. Pass through.
  if (value === null && evidence_quote === null && evidence_page === null) {
    return { ...field, confidence: 1, verified_page: null, match_quality: 'null-field' };
  }

  // Partial nulls — model returned some but not all parts of the triple.
  // Can't verify; flag as incomplete and let the UI decide what to show.
  if (evidence_quote === null || evidence_page === null) {
    return { ...field, confidence: 0, verified_page: null, match_quality: 'incomplete' };
  }

  return locate(field, evidence_quote, evidence_page, pageTexts);
}

function verifyParty(party: ContractParty, pageTexts: string[]): VerifiedParty {
  const located = locate(party, party.evidence_quote, party.evidence_page, pageTexts);
  // Strip the field-only match qualities that can't apply to parties.
  if (located.match_quality === 'null-field' || located.match_quality === 'incomplete') {
    // Defensive — parties never have null/incomplete shape per the schema.
    return { ...party, confidence: 0, verified_page: null, match_quality: 'not-found' };
  }
  return {
    ...party,
    confidence: located.confidence,
    verified_page: located.verified_page,
    match_quality: located.match_quality,
  };
}

/* -------------------------------------------------------------------------- */
/* Page-search core                                                           */
/* -------------------------------------------------------------------------- */

function locate<T extends object>(
  field: T,
  quote: string,
  claimedPage: number,
  pageTexts: string[]
): T & { confidence: number; verified_page: number | null; match_quality: MatchQuality } {
  const claimedIdx = claimedPage - 1; // 1-indexed → 0-indexed

  // 1) Try the claimed page first.
  if (claimedIdx >= 0 && claimedIdx < pageTexts.length) {
    const m = match(quote, pageTexts[claimedIdx]);
    if (m.strength !== 'none') {
      return {
        ...field,
        confidence: m.score,
        verified_page: claimedPage,
        match_quality: m.strength,
      };
    }
  }

  // 2) Try neighboring pages within NEIGHBOR_RADIUS.
  for (let delta = 1; delta <= NEIGHBOR_RADIUS; delta++) {
    for (const candidate of [claimedIdx - delta, claimedIdx + delta]) {
      if (candidate < 0 || candidate >= pageTexts.length) continue;
      const m = match(quote, pageTexts[candidate]);
      if (m.strength !== 'none') {
        return {
          ...field,
          confidence: 0.4,
          verified_page: candidate + 1,
          match_quality: 'wrong-page',
        };
      }
    }
  }

  // 3) Not found anywhere within radius — likely hallucinated.
  return { ...field, confidence: 0, verified_page: null, match_quality: 'not-found' };
}
