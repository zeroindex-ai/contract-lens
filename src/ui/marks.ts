import type { VerifiedDocumentExtraction } from '@/lib/verify';
import { bandFor, type ConfidenceBand } from './confidence';

/** One locatable citation: a party or key detail that verified on a real page. */
export interface CitationMark {
  /** Stable id, e.g. 'party:0' | 'detail:3'. */
  key: string;
  /** Human label, e.g. 'Provider' | 'Annual salary'. */
  label: string;
  /** Verbatim quote to find + highlight. */
  quote: string;
  /** 1-indexed page the quote verified on. */
  page: number;
  band: ConfidenceBand;
}

/**
 * Every citation that resolved to a real page in the source — parties and key
 * details. Quotes that were never found (not-found → verified_page null) are
 * excluded; they have no location to point at. The PDF preview highlights the
 * subset that falls on the visible page.
 */
export function buildCitationMarks(extraction: VerifiedDocumentExtraction): CitationMark[] {
  const out: CitationMark[] = [];

  extraction.parties.forEach((p, i) => {
    if (p.evidence_quote && p.verified_page !== null) {
      out.push({
        key: `party:${i}`,
        label: p.role || 'Party',
        quote: p.evidence_quote,
        page: p.verified_page,
        band: bandFor(p.confidence),
      });
    }
  });

  extraction.key_details.forEach((d, i) => {
    if (d.evidence_quote && d.verified_page !== null) {
      out.push({
        key: `detail:${i}`,
        label: d.label,
        quote: d.evidence_quote,
        page: d.verified_page,
        band: bandFor(d.confidence),
      });
    }
  });

  return out;
}
