// Custom eval-pack checks for contract-lens.
//
// contract-lens isn't a Q&A pipeline, so the built-in must_mention / citation
// checks don't fit. Instead the subject runs the real extraction + verification
// pipeline and stashes the VerifiedContractExtraction on result.metadata; these
// checks read it and compare against the per-contract ground truth carried on
// item.metadata.expected (see evals/golden.json).

import type { Check, GoldenItem, PartialResult } from '@zeroindex-ai/eval-pack';
import { SCALAR_FIELD_KEYS } from '@/schema/extraction';
import type { ScalarFieldKey } from '@/schema/extraction';
import type { MatchQuality, VerifiedContractExtraction, VerifiedField } from '@/lib/verify';
import { normalize } from '@/lib/match';

/**
 * Per-field ground truth:
 *   - `null`        → the field must be ABSENT (model correctly returned null).
 *   - `[]`          → the field must be PRESENT, but we don't pin its wording.
 *   - `[s1, s2...]` → the field must be present and contain every substring
 *                     (compared after the same normalization the matcher uses).
 * A field key omitted from `fields` is not asserted at all.
 */
export type ExpectedField = string[] | null;

export interface Expected {
  parties: string[];
  fields: Partial<Record<ScalarFieldKey, ExpectedField>>;
}

/** Match quality values that count as a successfully verified citation. */
const VERIFIED: ReadonlySet<MatchQuality> = new Set<MatchQuality>(['exact', 'normalized', 'fuzzy']);

function getExpected(item: GoldenItem): Expected {
  const expected = (item.metadata as { expected?: Expected } | undefined)?.expected;
  if (!expected) throw new Error(`golden item ${item.id} is missing metadata.expected`);
  return expected;
}

function getExtraction(result: PartialResult): VerifiedContractExtraction {
  const extraction = (result.metadata as { extraction?: VerifiedContractExtraction }).extraction;
  if (!extraction) throw new Error(`result ${result.id} is missing metadata.extraction`);
  return extraction;
}

function contains(value: string, needle: string): boolean {
  return normalize(value).includes(normalize(needle));
}

/**
 * field_values — every asserted scalar field matches ground truth: absent fields
 * are absent, present fields are present, and pinned substrings appear in the value.
 */
export const fieldValues: Check = (item, result) => {
  const expected = getExpected(item);
  const extraction = getExtraction(result);
  const mismatches: Array<{ field: ScalarFieldKey; reason: string }> = [];

  for (const key of SCALAR_FIELD_KEYS) {
    const want = expected.fields[key];
    if (want === undefined) continue; // not asserted
    const field: VerifiedField = extraction[key];

    if (want === null) {
      if (field.value !== null) {
        mismatches.push({ field: key, reason: `expected absent, got "${field.value}"` });
      }
      continue;
    }

    if (field.value === null) {
      mismatches.push({ field: key, reason: 'expected present, got absent' });
      continue;
    }

    for (const needle of want) {
      if (!contains(field.value, needle)) {
        mismatches.push({ field: key, reason: `value missing "${needle}"` });
      }
    }
  }

  return {
    name: 'field_values',
    ok: mismatches.length === 0,
    detail: mismatches.length > 0 ? { mismatches } : undefined,
  };
};

/** parties — every expected party name appears among the extracted parties. */
export const partiesPresent: Check = (item, result) => {
  const expected = getExpected(item);
  const extraction = getExtraction(result);
  const haystack = extraction.parties.map((p) => p.name).join(' • ');
  const missing = expected.parties.filter((name) => !contains(haystack, name));

  return {
    name: 'parties',
    ok: missing.length === 0,
    detail:
      missing.length > 0 ? { missing, extracted: extraction.parties.map((p) => p.name) } : undefined,
  };
};

/**
 * citations_verified — the core "document intelligence, verified" assertion:
 * every field the model claims is present (and every party) must carry a citation
 * that deterministically lands in the source PDF on the right page. A self-reported
 * quote that is not-found (hallucinated) or wrong-page fails the item.
 */
export const citationsVerified: Check = (_item, result) => {
  const extraction = getExtraction(result);
  const offenders: Array<{ field: string; match_quality: MatchQuality }> = [];

  for (const party of extraction.parties) {
    if (!VERIFIED.has(party.match_quality)) {
      offenders.push({ field: `party:${party.name}`, match_quality: party.match_quality });
    }
  }
  for (const key of SCALAR_FIELD_KEYS) {
    const field = extraction[key];
    if (field.value === null) continue; // absent field: nothing to verify
    if (!VERIFIED.has(field.match_quality)) {
      offenders.push({ field: key, match_quality: field.match_quality });
    }
  }

  return {
    name: 'citations_verified',
    ok: offenders.length === 0,
    detail: offenders.length > 0 ? { offenders } : undefined,
  };
};

export const checks: Check[] = [fieldValues, partiesPresent, citationsVerified];
