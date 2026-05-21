import type { VerifiedContractExtraction } from '@/lib/verify';
import { SCALAR_FIELD_KEYS, FIELD_LABELS } from '@/schema/extraction';
import { bandFor, type ConfidenceBand } from './confidence';

/** One locatable citation: a field/party whose quote verified on a real page. */
export interface CitationMark {
  /** Stable id, e.g. 'party:0' | 'field:term'. */
  key: string;
  /** Human label, e.g. 'Provider' | 'Term'. */
  label: string;
  /** Verbatim quote to find + highlight. */
  quote: string;
  /** 1-indexed page the quote verified on. */
  page: number;
  band: ConfidenceBand;
}

/**
 * Every citation that resolved to a real page in the source, across parties
 * and scalar fields. Fields the model marked absent (null-field) and quotes
 * that were never found (not-found → verified_page null) are excluded — they
 * have no location to point at. The PDF preview highlights the subset that
 * falls on the visible page.
 */
export function buildCitationMarks(extraction: VerifiedContractExtraction): CitationMark[] {
  const out: CitationMark[] = [];

  extraction.parties.forEach((p, i) => {
    if (p.evidence_quote && p.verified_page !== null) {
      out.push({
        key: `party:${i}`,
        label: p.role || 'Party',
        quote: p.evidence_quote,
        page: p.verified_page,
        band: bandFor(p.match_quality, p.confidence),
      });
    }
  });

  for (const key of SCALAR_FIELD_KEYS) {
    const f = extraction[key];
    if (f.value !== null && f.evidence_quote && f.verified_page !== null) {
      out.push({
        key: `field:${key}`,
        label: FIELD_LABELS[key],
        quote: f.evidence_quote,
        page: f.verified_page,
        band: bandFor(f.match_quality, f.confidence),
      });
    }
  }

  return out;
}
