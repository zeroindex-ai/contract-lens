import { describe, expect, it } from 'vitest';
import type { ContractExtraction } from '@/schema/extraction';
import { verify } from './verify';

/** Helper: build a fully-formed extraction with overrides. */
function makeExtraction(overrides: Partial<ContractExtraction> = {}): ContractExtraction {
  return {
    parties: [
      {
        name: 'Acme Corp',
        role: 'Seller',
        evidence_quote: 'Acme Corp ("Seller")',
        evidence_page: 1,
      },
    ],
    effective_date: { value: '2026-05-17', evidence_quote: 'May 17, 2026', evidence_page: 1 },
    term: { value: '3 years', evidence_quote: 'three (3) years', evidence_page: 2 },
    payment_terms: { value: '$50,000', evidence_quote: '$50,000', evidence_page: 3 },
    deliverables: { value: 'MVP', evidence_quote: 'the MVP', evidence_page: 2 },
    ip_ownership: { value: 'work-for-hire', evidence_quote: 'work made for hire', evidence_page: 4 },
    termination_clause: { value: '30 days', evidence_quote: '30 days written notice', evidence_page: 5 },
    governing_law: { value: 'Pennsylvania', evidence_quote: 'laws of Pennsylvania', evidence_page: 6 },
    kill_fee: { value: null, evidence_quote: null, evidence_page: null },
    limitation_of_liability: {
      value: 'capped at fees paid',
      evidence_quote: 'liability shall not exceed fees paid',
      evidence_page: 6,
    },
    ...overrides,
  };
}

const pageTexts = [
  // page 1
  'this Agreement is entered into between Acme Corp ("Seller") and Beta LLC on May 17, 2026',
  // page 2
  'the Term of this Agreement shall be three (3) years, during which Provider will deliver the MVP',
  // page 3
  'Payment of $50,000 is due upon execution of this Agreement',
  // page 4
  'all work product is work made for hire under U.S. copyright law',
  // page 5
  'either party may terminate with 30 days written notice',
  // page 6
  'this Agreement shall be governed by the laws of Pennsylvania. In no event shall liability shall not exceed fees paid in the prior 12 months',
];

describe('verify', () => {
  it('marks an exact-match field as exact / 1.0 / verified at claimed page', () => {
    const result = verify(makeExtraction(), pageTexts);
    expect(result.effective_date.match_quality).toBe('exact');
    expect(result.effective_date.confidence).toBe(1);
    expect(result.effective_date.verified_page).toBe(1);
  });

  it('marks a normalized-only match as normalized / 1.0', () => {
    // Smart quotes in the model's quote, straight quotes in the PDF text
    const ext = makeExtraction({
      parties: [
        { name: 'Acme Corp', role: 'Seller', evidence_quote: 'Acme Corp (“Seller”)', evidence_page: 1 },
      ],
    });
    const result = verify(ext, pageTexts);
    expect(result.parties[0].match_quality).toBe('normalized');
    expect(result.parties[0].confidence).toBe(1);
  });

  it('marks a paraphrased match as fuzzy with score from match driver', () => {
    const ext = makeExtraction({
      term: { value: '3 years', evidence_quote: 'three  (3)  yeers', evidence_page: 2 },
    });
    const result = verify(ext, pageTexts);
    expect(['fuzzy', 'normalized']).toContain(result.term.match_quality);
    expect(result.term.confidence).toBeGreaterThan(0.7);
  });

  it('flags a quote found on a neighbor page as wrong-page (confidence 0.4)', () => {
    // claim the payment quote is on page 5 (off-by-2 from real page 3)
    const ext = makeExtraction({
      payment_terms: { value: '$50,000', evidence_quote: '$50,000', evidence_page: 5 },
    });
    const result = verify(ext, pageTexts);
    expect(result.payment_terms.match_quality).toBe('wrong-page');
    expect(result.payment_terms.confidence).toBe(0.4);
    expect(result.payment_terms.verified_page).toBe(3);
  });

  it('flags a quote not in the document at all as not-found', () => {
    const ext = makeExtraction({
      governing_law: {
        value: 'Delaware',
        evidence_quote: 'governed by the laws of Delaware',
        evidence_page: 6,
      },
    });
    const result = verify(ext, pageTexts);
    expect(result.governing_law.match_quality).toBe('not-found');
    expect(result.governing_law.confidence).toBe(0);
    expect(result.governing_law.verified_page).toBeNull();
  });

  it('passes through all-null fields as null-field / 1.0 (unverifiable negative)', () => {
    const result = verify(makeExtraction(), pageTexts);
    expect(result.kill_fee.match_quality).toBe('null-field');
    expect(result.kill_fee.confidence).toBe(1);
    expect(result.kill_fee.verified_page).toBeNull();
  });

  it('flags partial-null fields as incomplete', () => {
    const ext = makeExtraction({
      term: { value: '3 years', evidence_quote: null, evidence_page: 2 },
    });
    const result = verify(ext, pageTexts);
    expect(result.term.match_quality).toBe('incomplete');
    expect(result.term.confidence).toBe(0);
  });

  it('verifies all parties independently', () => {
    const ext = makeExtraction({
      parties: [
        { name: 'Acme Corp', role: 'Seller', evidence_quote: 'Acme Corp ("Seller")', evidence_page: 1 },
        { name: 'Phantom Inc', role: 'Other', evidence_quote: 'never appears anywhere', evidence_page: 1 },
      ],
    });
    const result = verify(ext, pageTexts);
    expect(result.parties[0].match_quality).toBe('exact');
    expect(result.parties[1].match_quality).toBe('not-found');
  });

  it('tolerates a claimed_page out of range (treated as not-found)', () => {
    const ext = makeExtraction({
      term: { value: 'X', evidence_quote: 'three (3) years', evidence_page: 99 },
    });
    const result = verify(ext, pageTexts);
    // Page 99 doesn't exist; neighbor search from 99 has nothing in range — falls to not-found.
    expect(result.term.match_quality).toBe('not-found');
  });

  it('preserves the original value / evidence_quote / evidence_page on every field', () => {
    const ext = makeExtraction();
    const result = verify(ext, pageTexts);
    expect(result.effective_date.value).toBe('2026-05-17');
    expect(result.effective_date.evidence_quote).toBe('May 17, 2026');
    expect(result.effective_date.evidence_page).toBe(1);
    expect(result.parties[0].name).toBe('Acme Corp');
  });
});
