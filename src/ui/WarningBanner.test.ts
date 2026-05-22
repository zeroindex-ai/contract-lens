import { describe, expect, it } from 'vitest';
import { countUnverifiedFields } from './WarningBanner';
import type { VerifiedDocumentExtraction } from '@/lib/verify';

const kd = (confidence: number, match_quality: 'exact' | 'fuzzy' | 'wrong-page' | 'not-found' = 'exact') => ({
  label: 'x',
  value: 'y',
  evidence_quote: 'q',
  evidence_page: 1,
  confidence,
  verified_page: 1,
  match_quality,
});

function ext(detailConfidences: number[]): VerifiedDocumentExtraction {
  return {
    document_type: 'X',
    summary: 'y',
    parties: [
      { name: 'A', role: 'X', evidence_quote: 'q', evidence_page: 1, confidence: 1, verified_page: 1, match_quality: 'exact' },
    ],
    key_details: detailConfidences.map((c) => kd(c)),
  };
}

describe('countUnverifiedFields', () => {
  it('returns 0 unverified when every item is confident', () => {
    expect(countUnverifiedFields(ext([1, 0.9, 0.6]))).toEqual({ unverified: 0, total: 4 });
  });

  it('counts items below the review threshold (not-found / wrong-page)', () => {
    const e = ext([1, 0.4, 0]); // 0.4 and 0 are < 0.5
    expect(countUnverifiedFields(e)).toEqual({ unverified: 2, total: 4 });
  });

  it('does NOT count amber/fuzzy in [0.5, 0.9) as unverified', () => {
    expect(countUnverifiedFields(ext([0.7, 0.5])).unverified).toBe(0);
  });
});
