import { describe, it, expect } from 'vitest';
import type { VerifiedDocumentExtraction } from '@/lib/verify';
import { buildCitationMarks } from './marks';

function ext(): VerifiedDocumentExtraction {
  return {
    document_type: 'Agreement',
    summary: 'A sample.',
    parties: [
      { name: 'Acme Corp', role: 'Seller', evidence_quote: 'Acme Corp', evidence_page: 1, confidence: 1, verified_page: 1, match_quality: 'exact' },
    ],
    key_details: [
      { label: 'Term', value: '3 years', evidence_quote: 'three years', evidence_page: 2, confidence: 1, verified_page: 2, match_quality: 'exact' },
      { label: 'Bogus', value: 'x', evidence_quote: 'nowhere', evidence_page: 1, confidence: 0, verified_page: null, match_quality: 'not-found' },
      { label: 'Payment', value: '$5,000', evidence_quote: '$5,000', evidence_page: 1, confidence: 0.4, verified_page: 3, match_quality: 'wrong-page' },
    ],
  };
}

describe('buildCitationMarks', () => {
  it('emits a mark per party and per located key detail; excludes not-found', () => {
    const marks = buildCitationMarks(ext());
    expect(marks.filter((m) => m.key.startsWith('party:'))).toHaveLength(1);
    expect(marks.some((m) => m.key === 'detail:0')).toBe(true); // located
    expect(marks.some((m) => m.key === 'detail:1')).toBe(false); // not-found → no page
    expect(marks.some((m) => m.key === 'detail:2')).toBe(true); // wrong-page still located
    for (const m of marks) {
      expect(m.page).toBeGreaterThan(0);
      expect(['green', 'amber', 'red']).toContain(m.band);
      expect(m.quote.length).toBeGreaterThan(0);
    }
  });

  it('maps a wrong-page detail to its verified page, not the claimed page', () => {
    const marks = buildCitationMarks(ext());
    expect(marks.find((m) => m.key === 'detail:2')?.page).toBe(3);
  });
});
