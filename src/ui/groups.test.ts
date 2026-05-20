import { describe, expect, it } from 'vitest';
import { FIELD_GROUPS, summarize } from './groups';
import { SCALAR_FIELD_KEYS } from '@/schema/extraction';
import type { VerifiedContractExtraction } from '@/lib/verify';

describe('FIELD_GROUPS', () => {
  it('covers every scalar field exactly once', () => {
    const grouped = FIELD_GROUPS.flatMap((g) => g.fields).sort();
    expect(grouped).toEqual([...SCALAR_FIELD_KEYS].sort());
  });

  it('places parties in exactly one group', () => {
    expect(FIELD_GROUPS.filter((g) => g.includesParties)).toHaveLength(1);
  });
});

describe('summarize', () => {
  function field(confidence: number, mq: VerifiedContractExtraction['term']['match_quality']) {
    return { value: 'x', evidence_quote: 'x', evidence_page: 1, confidence, verified_page: 1, match_quality: mq };
  }

  it('buckets fields into verified / review / not-in-contract', () => {
    const v: VerifiedContractExtraction = {
      parties: [
        { name: 'A', role: 'X', evidence_quote: 'x', evidence_page: 1, confidence: 1, verified_page: 1, match_quality: 'exact' },
      ],
      effective_date: field(1, 'exact'), // green
      term: field(0.4, 'wrong-page'), // red → review
      payment_terms: field(0.7, 'fuzzy'), // amber → review
      deliverables: field(1, 'normalized'), // green
      ip_ownership: field(1, 'exact'), // green
      termination_clause: field(0, 'not-found'), // red → review
      governing_law: field(1, 'exact'), // green
      kill_fee: { value: null, evidence_quote: null, evidence_page: null, confidence: 1, verified_page: null, match_quality: 'null-field' }, // gray
      limitation_of_liability: field(1, 'exact'), // green
    };
    const s = summarize(v);
    // green: party + effective_date + deliverables + ip + governing + lol = 6
    // review: term + payment + termination = 3
    // gray: kill_fee = 1
    expect(s).toEqual({ verified: 6, review: 3, notInContract: 1, total: 10 });
  });
});
