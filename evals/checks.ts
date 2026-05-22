// Custom eval-pack checks for contract-lens.
//
// The subject runs the real extraction + verification pipeline and stashes the
// VerifiedDocumentExtraction on result.metadata; these checks read it and
// compare against the per-document ground truth on item.metadata.expected
// (see evals/golden.json). Extraction is open (no fixed field list), so the
// ground truth is expressed as facts that must appear among key_details, the
// expected document type, the parties, and (for negative controls) labels that
// must NOT be fabricated.

import type { Check, GoldenItem, PartialResult } from '@zeroindex-ai/eval-pack';
import type { MatchQuality, VerifiedDocumentExtraction } from '@/lib/verify';
import { normalize } from '@/lib/match';

export interface Expected {
  /** Substrings the model's document_type must contain (case-insensitive). */
  document_type?: string[];
  /** Each must appear among the extracted party names. */
  parties?: string[];
  /** Each must appear in some key detail's label or value. */
  key_facts?: string[];
  /** None of these may appear in any key detail (no-hallucination control). */
  must_not?: string[];
}

const VERIFIED: ReadonlySet<MatchQuality> = new Set<MatchQuality>(['exact', 'normalized', 'fuzzy']);

function getExpected(item: GoldenItem): Expected {
  const expected = (item.metadata as { expected?: Expected } | undefined)?.expected;
  if (!expected) throw new Error(`golden item ${item.id} is missing metadata.expected`);
  return expected;
}

function getExtraction(result: PartialResult): VerifiedDocumentExtraction {
  const extraction = (result.metadata as { extraction?: VerifiedDocumentExtraction }).extraction;
  if (!extraction) throw new Error(`result ${result.id} is missing metadata.extraction`);
  return extraction;
}

function contains(haystack: string, needle: string): boolean {
  return normalize(haystack).includes(normalize(needle));
}

/** The full searchable text of every key detail (label + value), joined. */
function detailsText(extraction: VerifiedDocumentExtraction): string {
  return extraction.key_details.map((d) => `${d.label} ${d.value}`).join(' • ');
}

/** document_type — the model's classification contains the expected substrings. */
export const documentType: Check = (item, result) => {
  const want = getExpected(item).document_type ?? [];
  const actual = getExtraction(result).document_type;
  const missing = want.filter((s) => !contains(actual, s));
  return { name: 'document_type', ok: missing.length === 0, detail: missing.length ? { missing, actual } : undefined };
};

/** parties — every expected party name appears among the extracted parties. */
export const partiesPresent: Check = (item, result) => {
  const want = getExpected(item).parties ?? [];
  const names = getExtraction(result).parties.map((p) => p.name).join(' • ');
  const missing = want.filter((s) => !contains(names, s));
  return { name: 'parties', ok: missing.length === 0, detail: missing.length ? { missing, extracted: names } : undefined };
};

/** key_facts — each expected fact appears in some key detail (label or value). */
export const keyFacts: Check = (item, result) => {
  const want = getExpected(item).key_facts ?? [];
  const text = detailsText(getExtraction(result));
  const missing = want.filter((s) => !contains(text, s));
  return { name: 'key_facts', ok: missing.length === 0, detail: missing.length ? { missing } : undefined };
};

/** must_not — none of the forbidden facts appear (no-hallucination control). */
export const mustNot: Check = (item, result) => {
  const forbidden = getExpected(item).must_not ?? [];
  const text = detailsText(getExtraction(result));
  const present = forbidden.filter((s) => contains(text, s));
  return { name: 'must_not', ok: present.length === 0, detail: present.length ? { present } : undefined };
};

/**
 * citations_verified — the core "verified" assertion: every party and key detail
 * the model returns must carry a citation that lands in the source PDF. A
 * not-found (hallucinated) or wrong-page quote flags the item.
 */
export const citationsVerified: Check = (_item, result) => {
  const extraction = getExtraction(result);
  const offenders: Array<{ item: string; match_quality: MatchQuality }> = [];
  for (const p of extraction.parties) {
    if (!VERIFIED.has(p.match_quality)) offenders.push({ item: `party:${p.name}`, match_quality: p.match_quality });
  }
  for (const d of extraction.key_details) {
    if (!VERIFIED.has(d.match_quality)) offenders.push({ item: d.label, match_quality: d.match_quality });
  }
  return { name: 'citations_verified', ok: offenders.length === 0, detail: offenders.length ? { offenders } : undefined };
};

export const checks: Check[] = [documentType, partiesPresent, keyFacts, mustNot, citationsVerified];
