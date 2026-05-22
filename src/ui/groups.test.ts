import { describe, expect, it } from 'vitest';
import { summarize } from './groups';
import type { VerifiedDocumentExtraction } from '@/lib/verify';

const kd = (confidence: number) => ({
  label: 'x',
  value: 'y',
  evidence_quote: 'q',
  evidence_page: 1,
  confidence,
  verified_page: 1,
  match_quality: 'exact' as const,
});
const party = (confidence: number) => ({
  name: 'A',
  role: 'X',
  evidence_quote: 'q',
  evidence_page: 1,
  confidence,
  verified_page: 1,
  match_quality: 'exact' as const,
});

describe('summarize', () => {
  it('buckets parties + key details into verified / review by confidence', () => {
    const v: VerifiedDocumentExtraction = {
      document_type: 'X',
      summary: 'y',
      parties: [party(1)], // green
      key_details: [kd(1), kd(0.4), kd(0.7)], // green, red→review, amber→review
    };
    expect(summarize(v)).toEqual({ verified: 2, review: 2, total: 4 });
  });

  it('handles an empty extraction', () => {
    const v: VerifiedDocumentExtraction = { document_type: 'X', summary: 'y', parties: [], key_details: [] };
    expect(summarize(v)).toEqual({ verified: 0, review: 0, total: 0 });
  });
});
