import { describe, expect, it } from 'vitest';
import { countUnverifiedFields } from './WarningBanner';
import type { VerifiedContractExtraction } from '@/lib/verify';

function ext(): VerifiedContractExtraction {
  const okField = {
    value: 'x',
    evidence_quote: 'x',
    evidence_page: 1,
    confidence: 1,
    verified_page: 1,
    match_quality: 'exact' as const,
  };
  return {
    parties: [
      {
        name: 'A',
        role: 'X',
        evidence_quote: 'x',
        evidence_page: 1,
        confidence: 1,
        verified_page: 1,
        match_quality: 'exact',
      },
    ],
    effective_date: okField,
    term: okField,
    payment_terms: okField,
    deliverables: okField,
    ip_ownership: okField,
    termination_clause: okField,
    governing_law: okField,
    kill_fee: okField,
    limitation_of_liability: okField,
  };
}

describe('countUnverifiedFields', () => {
  it('returns 0 unverified when all fields are clean', () => {
    expect(countUnverifiedFields(ext())).toEqual({ unverified: 0, total: 10 });
  });

  it('counts not-found / wrong-page / incomplete as unverified', () => {
    const e = ext();
    e.term = { ...e.term, confidence: 0, verified_page: null, match_quality: 'not-found' };
    e.payment_terms = { ...e.payment_terms, confidence: 0.4, verified_page: 2, match_quality: 'wrong-page' };
    e.deliverables = { ...e.deliverables, confidence: 0, verified_page: null, match_quality: 'incomplete' };
    expect(countUnverifiedFields(e)).toEqual({ unverified: 3, total: 10 });
  });

  it('does NOT count null-field as unverified (model said "not in contract")', () => {
    const e = ext();
    e.kill_fee = {
      value: null,
      evidence_quote: null,
      evidence_page: null,
      confidence: 1,
      verified_page: null,
      match_quality: 'null-field',
    };
    expect(countUnverifiedFields(e).unverified).toBe(0);
  });

  it('does NOT count amber/fuzzy in [0.5, 0.9) as unverified', () => {
    const e = ext();
    e.term = { ...e.term, confidence: 0.7, verified_page: 1, match_quality: 'fuzzy' };
    expect(countUnverifiedFields(e).unverified).toBe(0);
  });
});
