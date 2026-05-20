import type { ScalarFieldKey } from '@/schema/extraction';
import type { VerifiedContractExtraction } from '@/lib/verify';
import { bandFor } from './confidence';

/**
 * Field grouping for the details page. Parties render at the top of the first
 * group (handled specially because parties is an array). Every scalar field
 * belongs to exactly one group.
 */
export interface FieldGroup {
  title: string;
  /** Whether the parties block renders at the top of this group. */
  includesParties?: boolean;
  fields: ScalarFieldKey[];
}

export const FIELD_GROUPS: FieldGroup[] = [
  {
    title: 'Parties & dates',
    includesParties: true,
    fields: ['effective_date', 'term'],
  },
  {
    title: 'Commercial terms',
    fields: ['payment_terms', 'deliverables', 'kill_fee'],
  },
  {
    title: 'Legal terms',
    fields: ['ip_ownership', 'termination_clause', 'governing_law', 'limitation_of_liability'],
  },
];

export interface ExtractionSummary {
  verified: number; // green band
  review: number; // amber + red bands
  notInContract: number; // gray (null-field)
  total: number;
}

/** Count fields per confidence band across parties + all scalar fields. */
export function summarize(verified: VerifiedContractExtraction): ExtractionSummary {
  const all = [
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
  let v = 0;
  let r = 0;
  let n = 0;
  for (const f of all) {
    const band = bandFor(f.match_quality, f.confidence);
    if (band === 'gray') n++;
    else if (band === 'green') v++;
    else r++; // amber + red
  }
  return { verified: v, review: r, notInContract: n, total: all.length };
}
