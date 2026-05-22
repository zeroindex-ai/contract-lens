import { describe, expect, it } from 'vitest';
import type { DocumentExtraction, KeyDetail } from '@/schema/extraction';
import { verify } from './verify';

const pageTexts = [
  // page 1
  'this Agreement is entered into between Acme Corp ("Seller") and Beta LLC on May 17, 2026',
  // page 2
  'the Term of this Agreement shall be three (3) years, during which Provider will deliver the MVP',
  // page 3
  'Payment of $50,000 is due upon execution of this Agreement',
  // page 4
  'either party may terminate with 30 days written notice',
  // page 5
  'this Agreement shall be governed by the laws of Pennsylvania',
];

function ext(detail: KeyDetail, partyOverride?: Partial<DocumentExtraction['parties'][number]>): DocumentExtraction {
  return {
    document_type: 'Agreement',
    summary: 'A sample agreement.',
    parties: [
      {
        name: 'Acme Corp',
        role: 'Seller',
        evidence_quote: 'Acme Corp ("Seller")',
        evidence_page: 1,
        ...partyOverride,
      },
    ],
    key_details: [detail],
  };
}

describe('verify', () => {
  it('marks an exact-match detail as exact / 1.0 / verified at claimed page', () => {
    const r = verify(ext({ label: 'Term', value: '3 years', evidence_quote: 'three (3) years', evidence_page: 2 }), pageTexts);
    expect(r.key_details[0]!.match_quality).toBe('exact');
    expect(r.key_details[0]!.confidence).toBe(1);
    expect(r.key_details[0]!.verified_page).toBe(2);
  });

  it('marks a normalized-only match (curly quotes) as normalized / 1.0', () => {
    const r = verify(
      ext(
        { label: 'Party ref', value: 'Seller', evidence_quote: 'three (3) years', evidence_page: 2 },
        { evidence_quote: 'Acme Corp (“Seller”)' }
      ),
      pageTexts
    );
    expect(r.parties[0]!.match_quality).toBe('normalized');
  });

  it('marks a fuzzy match (typo) as fuzzy', () => {
    const r = verify(ext({ label: 'Term', value: '3 years', evidence_quote: 'three  (3)  yeers', evidence_page: 2 }), pageTexts);
    expect(r.key_details[0]!.match_quality).toBe('fuzzy');
    expect(r.key_details[0]!.confidence).toBeLessThan(1);
  });

  it('flags a mis-paginated quote as wrong-page (found on a neighbor)', () => {
    const r = verify(ext({ label: 'Payment', value: '$50,000', evidence_quote: '$50,000 is due', evidence_page: 1 }), pageTexts);
    expect(r.key_details[0]!.match_quality).toBe('wrong-page');
    expect(r.key_details[0]!.verified_page).toBe(3);
    expect(r.key_details[0]!.confidence).toBe(0.4);
  });

  it('flags a hallucinated quote as not-found / 0 / no page', () => {
    const r = verify(ext({ label: 'Bogus', value: 'x', evidence_quote: 'a clause that appears nowhere at all', evidence_page: 2 }), pageTexts);
    expect(r.key_details[0]!.match_quality).toBe('not-found');
    expect(r.key_details[0]!.confidence).toBe(0);
    expect(r.key_details[0]!.verified_page).toBeNull();
  });

  it('tolerates an out-of-range claimed page (model emitted 0) by searching the PDF', () => {
    const r = verify(ext({ label: 'Date', value: 'May 17, 2026', evidence_quote: 'May 17, 2026', evidence_page: 0 }), pageTexts);
    expect(r.key_details[0]!.match_quality).toBe('wrong-page');
    expect(r.key_details[0]!.verified_page).toBe(1);
  });

  it('passes document_type and summary through unchanged', () => {
    const r = verify(ext({ label: 'Term', value: '3 years', evidence_quote: 'three (3) years', evidence_page: 2 }), pageTexts);
    expect(r.document_type).toBe('Agreement');
    expect(r.summary).toBe('A sample agreement.');
  });
});
